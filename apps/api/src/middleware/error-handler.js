/**
 * @file error-handler.js
 * @description Centralized Express error-handling middleware. Normalizes all
 * errors (operational AppErrors, malformed request bodies, and unexpected
 * errors) into one consistent JSON response shape. Must be registered last.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';
import { AppError } from '../utils/app-error.js';

/**
 * Determines whether an error was produced by Express's JSON body parser
 * failing to parse a malformed request body.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isMalformedJsonError(error) {
  return (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === HTTP_STATUS.BAD_REQUEST &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  );
}

/**
 * Centralized error-handling middleware.
 *
 * @param {unknown} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {import('express').Response}
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (isMalformedJsonError(err)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Request body contains malformed JSON.',
      },
    });
  }

  if (err instanceof AppError && err.isOperational) {
    const body = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (err.details !== undefined) {
      body.error.details = err.details;
    }

    return res.status(err.statusCode).json(body);
  }

  // Unexpected errors are logged internally but never exposed to clients.
  console.error(err);

  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}
