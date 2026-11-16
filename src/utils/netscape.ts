import { HTTP_ONLY_PREFIX, NETSCAPE_HEADER } from '../constants';
import type { StoredCookie } from '../typings';
import { isExpired } from './rfc6265';

/**
 * Parses Netscape cookies.txt content into structured stored cookies.
 *
 * @example
 * ```ts
 * const cookies = parseNetscapeCookies(fileContent);
 * ```
 */
export function parseNetscapeCookies(content: string, now = Date.now()): StoredCookie[] {
  const cookies: StoredCookie[] = [];
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let line = rawLine;
    let httpOnly = false;

    if (trimmed.startsWith(HTTP_ONLY_PREFIX)) {
      httpOnly = true;
      line = trimmed.slice(HTTP_ONLY_PREFIX.length);
    } else if (trimmed.startsWith('#')) {
      continue;
    }

    const parts = line.split('\t');
    if (parts.length < 7) continue;

    const [rawDomain, includeSubdomains, path, secureStr, expStr, name] = parts;
    if (!rawDomain || !path || !name) continue;

    const value = parts.slice(6).join('\t');
    const hostOnly = includeSubdomains?.toUpperCase() !== 'TRUE';
    const domain = rawDomain.replace(/^\./, '').toLowerCase();
    const secure = secureStr?.toUpperCase() === 'TRUE';
    const expSec = Number.parseInt(expStr ?? '0', 10);
    const expires = !Number.isNaN(expSec) && expSec > 0 ? expSec * 1000 : null;

    if (expires !== null && expires <= now) {
      continue;
    }

    cookies.push({
      name,
      value,
      domain,
      path,
      hostOnly,
      secure,
      httpOnly,
      expires,
      creationTime: now,
      lastAccessTime: now,
    });
  }

  return cookies;
}

/**
 * Serializes cookies into Netscape cookies.txt format.
 *
 * @example
 * ```ts
 * const text = serializeNetscapeCookies(cookies, { persistSessionCookies: false });
 * ```
 */
export function serializeNetscapeCookies(
  cookies: Iterable<StoredCookie>,
  options: { persistSessionCookies?: boolean; now?: number } = {}
): string {
  const now = options.now ?? Date.now();
  const persistSession = options.persistSessionCookies ?? false;
  const lines: string[] = [NETSCAPE_HEADER, ''];

  for (const cookie of cookies) {
    if (isExpired(cookie, now)) continue;
    if (cookie.expires === null && !persistSession) continue;

    const domainField = `${cookie.httpOnly ? HTTP_ONLY_PREFIX : ''}${
      cookie.hostOnly ? cookie.domain : `.${cookie.domain}`
    }`;
    const includeSubdomains = cookie.hostOnly ? 'FALSE' : 'TRUE';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expiration = cookie.expires === null ? '0' : String(Math.floor(cookie.expires / 1000));

    lines.push(
      [
        domainField,
        includeSubdomains,
        cookie.path,
        secure,
        expiration,
        cookie.name,
        cookie.value,
      ].join('\t')
    );
  }

  return `${lines.join('\n')}\n`;
}
