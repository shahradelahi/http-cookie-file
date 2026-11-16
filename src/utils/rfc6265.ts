import { isIP } from 'node:net';

import type { SameSite, StoredCookie } from '../typings';

export function getCookieKey(cookie: Pick<StoredCookie, 'name' | 'domain' | 'path'>): string {
  return `${cookie.name}\0${cookie.domain}\0${cookie.path}`;
}

export function getDefaultPath(requestPath: string): string {
  if (!requestPath || !requestPath.startsWith('/')) {
    return '/';
  }
  const lastSlash = requestPath.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : requestPath.slice(0, lastSlash);
}

/**
 * Checks whether a request hostname matches a cookie domain according to RFC 6265.
 */
export function domainMatch(hostname: string, cookieDomain: string, hostOnly: boolean): boolean {
  const host = hostname.toLowerCase();
  const domain = cookieDomain.toLowerCase().replace(/^\./, '');

  if (host === domain) {
    return true;
  }
  if (hostOnly || isIP(host) !== 0) {
    return false;
  }
  return host.endsWith(`.${domain}`);
}

/**
 * Checks whether a request path matches a cookie path according to RFC 6265.
 */
export function pathMatch(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

export function isExpired(cookie: Pick<StoredCookie, 'expires'>, now = Date.now()): boolean {
  return cookie.expires !== null && cookie.expires <= now;
}

/**
 * Validates if a cookie matches a request URL (domain, path, and secure flags).
 */
export function matchesUrl(cookie: StoredCookie, url: URL, now = Date.now()): boolean {
  if (isExpired(cookie, now)) {
    return false;
  }
  if (cookie.secure && url.protocol !== 'https:') {
    return false;
  }
  if (!domainMatch(url.hostname, cookie.domain, cookie.hostOnly)) {
    return false;
  }
  return pathMatch(url.pathname || '/', cookie.path);
}

/**
 * Parses a raw Set-Cookie header for a given request URL under RFC 6265 rules.
 *
 * @example
 * ```ts
 * const cookie = parseSetCookie('sid=123; Secure', new URL('https://example.com'));
 * ```
 */
export function parseSetCookie(
  header: string,
  requestUrl: URL,
  now = Date.now()
): StoredCookie | null {
  const parts = header.split(';');
  const nameValue = parts[0];
  if (!nameValue) return null;

  const eqIdx = nameValue.indexOf('=');
  if (eqIdx === -1) return null;

  const name = nameValue.slice(0, eqIdx).trim();
  const value = nameValue.slice(eqIdx + 1).trim();
  if (!name) return null;

  let attrDomain: string | undefined;
  let attrPath: string | undefined;
  let maxAge: number | undefined;
  let expiresAt: number | null = null;
  let secure = false;
  let httpOnly = false;
  let sameSite: SameSite | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]?.trim();
    if (!part) continue;

    const attrEq = part.indexOf('=');
    if (attrEq === -1) {
      const flag = part.toLowerCase();
      if (flag === 'secure') secure = true;
      else if (flag === 'httponly') httpOnly = true;
      continue;
    }

    const attrName = part.slice(0, attrEq).trim().toLowerCase();
    const attrVal = part.slice(attrEq + 1).trim();

    switch (attrName) {
      case 'domain': {
        const cleaned = attrVal.replace(/^\./, '').toLowerCase();
        if (cleaned) attrDomain = cleaned;
        break;
      }
      case 'path': {
        if (attrVal.startsWith('/')) attrPath = attrVal;
        break;
      }
      case 'max-age': {
        if (/^-?\d+$/.test(attrVal)) {
          const seconds = Number.parseInt(attrVal, 10);
          maxAge = seconds <= 0 ? 0 : now + seconds * 1000;
        }
        break;
      }
      case 'expires': {
        const parsed = Date.parse(attrVal);
        if (!Number.isNaN(parsed)) {
          expiresAt = parsed;
        }
        break;
      }
      case 'samesite': {
        const lower = attrVal.toLowerCase();
        if (lower === 'strict' || lower === 'lax' || lower === 'none') {
          sameSite = lower;
        }
        break;
      }
    }
  }

  const hostOnly = attrDomain === undefined;
  const domain = attrDomain ?? requestUrl.hostname.toLowerCase();

  if (!hostOnly && !domainMatch(requestUrl.hostname, domain, false)) {
    return null;
  }

  const path = attrPath ?? getDefaultPath(requestUrl.pathname || '/');

  if (name.startsWith('__Secure-') && (!secure || requestUrl.protocol !== 'https:')) {
    return null;
  }
  if (
    name.startsWith('__Host-') &&
    (!secure || requestUrl.protocol !== 'https:' || !hostOnly || path !== '/')
  ) {
    return null;
  }

  const expires = maxAge !== undefined ? maxAge : expiresAt;

  return {
    name,
    value,
    domain,
    path,
    hostOnly,
    secure,
    httpOnly,
    expires,
    sameSite,
    creationTime: now,
    lastAccessTime: now,
  };
}
