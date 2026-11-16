import type { PathLike } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { FileWriter } from '@se-oss/file-writer';

import { DEFAULT_ENCODING, DEFAULT_FORMAT } from '../constants';
import { CookieFileError } from '../errors';
import type { CookieFileFormat, CookieFileOptions, SetCookieInput, StoredCookie } from '../typings';
import { parseNetscapeCookies, serializeNetscapeCookies } from '../utils/netscape';
import { resolveFilePath } from '../utils/path';
import { getCookieKey, isExpired, matchesUrl, parseSetCookie } from '../utils/rfc6265';

/**
 * Atomic HTTP cookie jar backing Netscape cookies.txt and JSON files.
 *
 * @example
 * ```ts
 * const cookies = new CookieFile('./cookies.txt');
 * await cookies.setCookie('sid=123; Path=/', 'https://example.com');
 * const header = await cookies.getCookieHeader('https://example.com');
 * ```
 */
export class CookieFile {
  readonly #filename: PathLike;
  readonly #filePath: string;
  readonly #writer: FileWriter;
  readonly #format: CookieFileFormat;
  readonly #encoding: BufferEncoding;
  readonly #autoSave: boolean;
  readonly #persistSessionCookies: boolean;
  readonly #createDir: boolean;

  #cookies = new Map<string, StoredCookie>();
  #loaded = false;
  #loadPromise: Promise<void> | null = null;
  #dirCreated = false;

  constructor(filename: PathLike, options: CookieFileOptions = {}) {
    this.#filename = filename;
    this.#filePath = resolveFilePath(filename);
    this.#format = options.format ?? DEFAULT_FORMAT;
    this.#encoding = options.encoding ?? DEFAULT_ENCODING;
    this.#autoSave = options.autoSave ?? true;
    this.#persistSessionCookies = options.persistSessionCookies ?? false;
    this.#createDir = options.createDir ?? true;
    this.#writer = new FileWriter(filename, {
      encoding: this.#encoding,
      ...options.writer,
    });
  }

  /** Path to the underlying cookie file. */
  get filename(): PathLike {
    return this.#filename;
  }

  /** Indicates whether the cookie file has been loaded into memory. */
  get isLoaded(): boolean {
    return this.#loaded;
  }

  /** Number of cookies currently stored in memory. */
  get size(): number {
    return this.#cookies.size;
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    this.#loadPromise ??= this.load().finally(() => {
      this.#loadPromise = null;
    });
    await this.#loadPromise;
  }

  /**
   * Reads cookies from disk into memory. Non-existent files are treated as empty.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.#filePath, { encoding: this.#encoding });
      const now = Date.now();
      const parsed =
        this.#format === 'json'
          ? (JSON.parse(content) as StoredCookie[])
          : parseNetscapeCookies(content, now);

      this.#cookies.clear();
      for (const cookie of parsed) {
        if (!isExpired(cookie, now)) {
          this.#cookies.set(getCookieKey(cookie), cookie);
        }
      }
      this.#loaded = true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.#cookies.clear();
        this.#loaded = true;
        return;
      }
      throw new CookieFileError(
        `Failed to load cookie file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Atomically flushes memory cookies to disk using `@se-oss/file-writer`.
   */
  async save(): Promise<void> {
    await this.#ensureLoaded();

    try {
      if (this.#createDir && !this.#dirCreated) {
        await mkdir(dirname(this.#filePath), { recursive: true });
        this.#dirCreated = true;
      }

      const content = this.#format === 'json' ? this.toJSONString() : this.toNetscapeString();

      await this.#writer.write(content);
    } catch (err) {
      throw new CookieFileError(
        `Failed to save cookie file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Adds or updates a structured cookie.
   *
   * @example
   * ```ts
   * await cookies.set({ name: 'theme', value: 'dark', domain: 'example.com' });
   * ```
   */
  async set(input: SetCookieInput): Promise<void> {
    await this.#ensureLoaded();
    const now = Date.now();

    let expires: number | null = null;
    if (input.maxAge !== undefined) {
      expires = input.maxAge <= 0 ? 0 : now + input.maxAge * 1000;
    } else if (input.expires !== undefined && input.expires !== null) {
      expires = input.expires instanceof Date ? input.expires.getTime() : input.expires;
    }

    const cookie: StoredCookie = {
      name: input.name,
      value: input.value,
      domain: input.domain.replace(/^\./, '').toLowerCase(),
      path: input.path ?? '/',
      hostOnly: input.hostOnly ?? true,
      secure: input.secure ?? false,
      httpOnly: input.httpOnly ?? false,
      expires,
      sameSite: input.sameSite,
      creationTime: now,
      lastAccessTime: now,
    };

    const changed = this.#upsertCookie(cookie, now);
    if (changed && this.#autoSave) {
      await this.save();
    }
  }

  /**
   * Parses a raw Set-Cookie header and stores it according to RFC 6265 rules.
   *
   * @example
   * ```ts
   * await cookies.setCookie('sid=123; Path=/; Secure', 'https://example.com');
   * ```
   */
  async setCookie(rawSetCookie: string, url: string | URL): Promise<boolean> {
    await this.#ensureLoaded();
    const targetUrl = typeof url === 'string' ? new URL(url) : url;
    const now = Date.now();
    const parsed = parseSetCookie(rawSetCookie, targetUrl, now);
    if (!parsed) return false;

    const changed = this.#upsertCookie(parsed, now);
    if (changed && this.#autoSave) {
      await this.save();
    }
    return true;
  }

  /**
   * Extracts Set-Cookie headers from a Response or Headers object and stores them.
   *
   * @example
   * ```ts
   * const res = await fetch('https://example.com/login');
   * await cookies.setFromResponse(res, 'https://example.com/login');
   * ```
   */
  async setFromResponse(source: Response | Headers, url: string | URL): Promise<void> {
    const headers = 'headers' in source ? source.headers : source;
    const setCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : headers.get('set-cookie')
          ? [headers.get('set-cookie')!]
          : [];

    if (setCookies.length === 0) return;

    await this.#ensureLoaded();
    const targetUrl = typeof url === 'string' ? new URL(url) : url;
    const now = Date.now();
    let changed = false;

    for (const header of setCookies) {
      const parsed = parseSetCookie(header, targetUrl, now);
      if (parsed && this.#upsertCookie(parsed, now)) {
        changed = true;
      }
    }

    if (changed && this.#autoSave) {
      await this.save();
    }
  }

  /**
   * Retrieves non-expired cookies matching the specified URL.
   */
  async getCookies(url?: string | URL): Promise<StoredCookie[]> {
    await this.#ensureLoaded();
    const now = Date.now();
    const targetUrl = url ? (typeof url === 'string' ? new URL(url) : url) : null;
    const matched: StoredCookie[] = [];

    for (const [key, cookie] of this.#cookies) {
      if (isExpired(cookie, now)) {
        this.#cookies.delete(key);
        continue;
      }
      if (!targetUrl || matchesUrl(cookie, targetUrl, now)) {
        cookie.lastAccessTime = now;
        matched.push({ ...cookie });
      }
    }

    matched.sort((a, b) => {
      if (b.path.length !== a.path.length) {
        return b.path.length - a.path.length;
      }
      return a.creationTime - b.creationTime;
    });

    return matched;
  }

  /**
   * Generates a formatted Cookie header string for the given target URL.
   *
   * @example
   * ```ts
   * const header = await cookies.getCookieHeader('https://example.com/api');
   * // -> "sid=123; theme=dark"
   * ```
   */
  async getCookieHeader(url: string | URL): Promise<string> {
    const cookies = await this.getCookies(url);
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Deletes a cookie by name, optionally filtered by domain and path.
   */
  async delete(name: string, options?: { domain?: string; path?: string }): Promise<boolean> {
    await this.#ensureLoaded();
    let deleted = false;
    const normalizedDomain = options?.domain?.replace(/^\./, '').toLowerCase();

    for (const [key, cookie] of this.#cookies) {
      if (cookie.name !== name) continue;
      if (normalizedDomain && cookie.domain !== normalizedDomain) continue;
      if (options?.path && cookie.path !== options.path) continue;
      this.#cookies.delete(key);
      deleted = true;
    }

    if (deleted && this.#autoSave) {
      await this.save();
    }
    return deleted;
  }

  /**
   * Deletes all cookies from memory and updates disk.
   */
  async clear(): Promise<void> {
    await this.#ensureLoaded();
    this.#cookies.clear();
    if (this.#autoSave) {
      await this.save();
    }
  }

  /** Serializes current cookies into Netscape cookies.txt format. */
  toNetscapeString(): string {
    return serializeNetscapeCookies(this.#cookies.values(), {
      persistSessionCookies: this.#persistSessionCookies,
    });
  }

  /** Serializes current cookies into JSON string format. */
  toJSONString(): string {
    const now = Date.now();
    const list = Array.from(this.#cookies.values()).filter((cookie) => {
      if (isExpired(cookie, now)) return false;
      return cookie.expires !== null || this.#persistSessionCookies;
    });
    return `${JSON.stringify(list, null, 2)}\n`;
  }

  #upsertCookie(cookie: StoredCookie, now: number): boolean {
    const key = getCookieKey(cookie);
    const existing = this.#cookies.get(key);

    if (isExpired(cookie, now)) {
      return this.#cookies.delete(key);
    }

    if (existing) {
      cookie.creationTime = existing.creationTime;
    }

    this.#cookies.set(key, cookie);
    return true;
  }
}
