/**
 * @file validate.js
 * @description Express middleware for validating request payloads with Zod.
 *
 * Validation occurs before controllers execute so downstream business logic
 * always receives normalized, trusted input. Successful validation replaces
 * the original request body with the parsed result, allowing Zod transforms,
 * defaults, and coercion to be applied automatically.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';

/**
 * Creates an Express middleware that validates the incoming request body
 * against the supplied Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema Zod schema used to validate
 * the request body.
 * @returns {import('express').RequestHandler} Validation middleware.
 */
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(
        new AppError('Request validation failed.', HTTP_STATUS.UNPROCESSABLE_ENTITY, {
          code: 'VALIDATION_ERROR',
          details: result.error.flatten(),
        }),
      );

      return;
    }

    req.body = result.data;

    next();
  };
}
