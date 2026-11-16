import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CookieFile } from './core/CookieFile';
import { parseNetscapeCookies, serializeNetscapeCookies } from './utils/netscape';
import { domainMatch, parseSetCookie, pathMatch } from './utils/rfc6265';

const TEST_DIR = join(process.cwd(), '.tmp-test-cookie-file');

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('rfc6265 utilities', () => {
  it('matches domains correctly', () => {
    expect(domainMatch('example.com', 'example.com', true)).toBe(true);
    expect(domainMatch('sub.example.com', 'example.com', true)).toBe(false);
    expect(domainMatch('sub.example.com', 'example.com', false)).toBe(true);
    expect(domainMatch('other.com', 'example.com', false)).toBe(false);
  });

  it('matches paths correctly', () => {
    expect(pathMatch('/api/v1', '/api')).toBe(true);
    expect(pathMatch('/api', '/api')).toBe(true);
    expect(pathMatch('/apiv1', '/api')).toBe(false);
  });

  it('parses set-cookie string', () => {
    const url = new URL('https://example.com/api/login');
    const cookie = parseSetCookie('sid=123; Path=/api; Secure; HttpOnly; Max-Age=3600', url);

    expect(cookie).not.toBeNull();
    expect(cookie?.name).toBe('sid');
    expect(cookie?.value).toBe('123');
    expect(cookie?.path).toBe('/api');
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.hostOnly).toBe(true);
  });

  it('enforces __Host- prefix rules', () => {
    const secureUrl = new URL('https://example.com/');
    const insecureUrl = new URL('http://example.com/');

    expect(parseSetCookie('__Host-id=1; Secure; Path=/', secureUrl)).not.toBeNull();
    expect(parseSetCookie('__Host-id=1; Path=/', secureUrl)).toBeNull();
    expect(parseSetCookie('__Host-id=1; Secure; Path=/', insecureUrl)).toBeNull();
    expect(parseSetCookie('__Host-id=1; Secure; Domain=example.com; Path=/', secureUrl)).toBeNull();
  });
});

describe('netscape parser & serializer', () => {
  it('parses and serializes netscape format including #HttpOnly_', () => {
    const raw = `# Netscape HTTP Cookie File
.example.com\tTRUE\t/\tTRUE\t1799999999\tsession\tabc123
#HttpOnly_api.example.com\tFALSE\t/v1\tFALSE\t0\ttoken\txyz
`;

    const parsed = parseNetscapeCookies(raw);
    expect(parsed).toHaveLength(2);

    expect(parsed[0]?.domain).toBe('example.com');
    expect(parsed[0]?.hostOnly).toBe(false);
    expect(parsed[0]?.httpOnly).toBe(false);

    expect(parsed[1]?.domain).toBe('api.example.com');
    expect(parsed[1]?.hostOnly).toBe(true);
    expect(parsed[1]?.httpOnly).toBe(true);

    const serialized = serializeNetscapeCookies(parsed, { persistSessionCookies: true });
    expect(serialized).toContain('.example.com\tTRUE\t/\tTRUE');
    expect(serialized).toContain('#HttpOnly_api.example.com\tFALSE\t/v1\tFALSE');
  });
});

describe('CookieFile', () => {
  it('handles ENOENT cleanly on initial load', async () => {
    const filePath = join(TEST_DIR, 'non-existent', 'cookies.txt');
    const cookieFile = new CookieFile(filePath);

    expect(cookieFile.isLoaded).toBe(false);
    await cookieFile.load();
    expect(cookieFile.isLoaded).toBe(true);
    expect(cookieFile.size).toBe(0);
  });

  it('stores, queries, and auto-saves cookies', async () => {
    const filePath = join(TEST_DIR, 'cookies.txt');
    const cookieFile = new CookieFile(filePath, { persistSessionCookies: true });

    await cookieFile.setCookie('sid=123; Path=/; Secure', 'https://example.com');
    await cookieFile.setCookie('theme=dark; Path=/', 'https://example.com');

    const header = await cookieFile.getCookieHeader('https://example.com');
    expect(header).toBe('sid=123; theme=dark');

    expect(existsSync(filePath)).toBe(true);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('sid\t123');
    expect(content).toContain('theme\tdark');
  });

  it('ingests cookies from Response/Headers', async () => {
    const filePath = join(TEST_DIR, 'resp-cookies.txt');
    const cookieFile = new CookieFile(filePath);

    const headers = new Headers();
    headers.append('Set-Cookie', 'auth=token123; Path=/; Secure; Max-Age=3600');

    await cookieFile.setFromResponse(headers, 'https://api.example.com');
    const cookies = await cookieFile.getCookies('https://api.example.com');

    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe('auth');
    expect(cookies[0]?.value).toBe('token123');
  });

  it('handles concurrent write operations safely', async () => {
    const filePath = join(TEST_DIR, 'concurrent-cookies.txt');
    const cookieFile = new CookieFile(filePath, { persistSessionCookies: true });

    const count = 50;
    const promises: Promise<boolean>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        cookieFile.setCookie(`user_${i}=val_${i}; Path=/; Max-Age=3600`, 'https://example.com')
      );
    }

    await Promise.all(promises);

    expect(cookieFile.size).toBe(count);

    const reloaded = new CookieFile(filePath);
    await reloaded.load();
    expect(reloaded.size).toBe(count);
  });
});
