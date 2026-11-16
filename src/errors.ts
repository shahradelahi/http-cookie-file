export class CookieFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = 'CookieFileError';
    this.cause = options?.cause;
    Object.setPrototypeOf(this, CookieFileError.prototype);
  }
}
