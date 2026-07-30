/**
 * @file app-error.js
 * @description Operational error type for expected, recoverable failures
 * (validation errors, not-found resources, etc.). Thrown AppErrors are
 * handled distinctly from unexpected/programmer errors by error-handler.js.
 */

/**
 * Represents an expected, operational error with an HTTP status code and
 * an optional machine-readable error code.
 */
export class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message.
   * @param {number} statusCode - HTTP status code to respond with.
   * @param {object} [options]
   * @param {string} [options.code] - Machine-readable error code (e.g. 'NOT_FOUND').
   * @param {boolean} [options.isOperational=true] - Whether this is an expected,
   *   handled failure rather than a programming/unexpected error.
   * @param {*} [options.details] - Optional additional error detail, only
   *   included in responses when explicitly provided and safe to expose.
   */
  constructor(message, statusCode, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code ?? 'APP_ERROR';
    this.isOperational = options.isOperational ?? true;
    this.details = options.details;

    Error.captureStackTrace?.(this, AppError);
  }
}
