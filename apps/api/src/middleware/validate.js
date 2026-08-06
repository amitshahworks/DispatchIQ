/**
 * @file validate.js
 * @description Express middleware factory for validating request data with
 * Zod before controllers execute.
 *
 * The middleware supports request bodies, query parameters, and route
 * parameters. Successful validation exposes Zod's normalized result through
 * the same request property consumed by downstream controllers.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';

const SUPPORTED_TARGETS = new Set(['body', 'query', 'params']);

/**
 * Assigns normalized validation output to the selected request property.
 *
 * Express 5 exposes `req.query` through a getter, so direct assignment throws.
 * Defining an own property on the request instance safely shadows that getter
 * for the remainder of the request lifecycle.
 *
 * @param {import('express').Request} req Express request.
 * @param {'body' | 'query' | 'params'} target Validated request property.
 * @param {unknown} value Parsed Zod output.
 * @returns {void}
 */
function assignValidatedValue(req, target, value) {
  if (target === 'query') {
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    return;
  }

  req[target] = value;
}

/**
 * Creates middleware that validates one part of an Express request.
 *
 * @param {import('zod').ZodType} schema Zod schema used for validation.
 * @param {'body' | 'query' | 'params'} [target='body'] Request property to
 * validate.
 * @returns {import('express').RequestHandler} Express validation middleware.
 * @throws {Error} When an unsupported validation target is configured.
 *
 * @example
 * validate(registerSchema)
 * validate(listJobsQuerySchema, 'query')
 * validate(jobIdParamsSchema, 'params')
 */
export function validate(schema, target = 'body') {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported validation target "${target}". Expected body, query, or params.`);
  }

  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      next(
        new AppError('Request validation failed.', HTTP_STATUS.UNPROCESSABLE_ENTITY, {
          code: 'VALIDATION_ERROR',
          details: {
            target,
            ...result.error.flatten(),
          },
        }),
      );

      return;
    }

    assignValidatedValue(req, target, result.data);

    next();
  };
}
