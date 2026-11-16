import type { FileWriterOptions } from '@se-oss/file-writer';

export type CookieFileFormat = 'netscape' | 'json';
export type SameSite = 'strict' | 'lax' | 'none';

export interface StoredCookie {
  name: string;
  value: string;
  /** Lowercased domain without a leading dot. */
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  httpOnly: boolean;
  /** Unix timestamp in milliseconds, or `null` for session cookies. */
  expires: number | null;
  sameSite?: SameSite;
  creationTime: number;
  lastAccessTime: number;
}

export interface SetCookieInput {
  name: string;
  value: string;
  domain: string;
  path?: string;
  hostOnly?: boolean;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: Date | number | null;
  maxAge?: number;
  sameSite?: SameSite;
}

export interface CookieFileOptions {
  /** Storage format on disk. Default: `'netscape'`. */
  format?: CookieFileFormat;
  /** File encoding. Default: `'utf-8'`. */
  encoding?: BufferEncoding;
  /** Automatically persist changes to disk via FileWriter. Default: `true`. */
  autoSave?: boolean;
  /** Include session cookies (`expires === null`) when saving to disk. Default: `false`. */
  persistSessionCookies?: boolean;
  /** Ensure parent directories exist before writing. Default: `true`. */
  createDir?: boolean;
  /** Options forwarded to `@se-oss/file-writer`. */
  writer?: FileWriterOptions;
}
