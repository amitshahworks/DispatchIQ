/**
 * @file async-handler.js
 * @description Wraps async Express route handlers so that thrown errors and
 * rejected promises are forwarded to next(), instead of causing an unhandled
 * rejection or crashing the process.
 */

/**
 * Wraps an async Express handler, forwarding any thrown error or rejected
 * promise to Express's error-handling middleware via next().
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<any>} handler
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>}
 */
export function asyncHandler(handler) {
  return async function wrappedHandler(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
