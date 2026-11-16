import type { PathLike } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function resolveFilePath(file: PathLike): string {
  if (file instanceof URL) {
    return fileURLToPath(file);
  }
  if (Buffer.isBuffer(file)) {
    return file.toString('utf-8');
  }
  return String(file);
}
