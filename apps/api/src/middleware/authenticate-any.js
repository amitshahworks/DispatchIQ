/**
 * @file authenticate-any.js
 * @description Selects an approved DispatchIQ authentication mechanism for
 * routes that support both JWT access tokens and API keys.
 *
 * Interactive clients authenticate with `Authorization: Bearer <token>`.
 * Programmatic clients authenticate with `X-API-Key`.
 *
 * Authentication selection is deterministic. When an Authorization header is
 * present, JWT authentication is used and API-key authentication is not used
 * as a fallback if the JWT is malformed, expired, or invalid. This prevents
 * ambiguous credential handling and unintended authentication downgrades.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';
import { authenticateApiKey } from './authenticate-api-key.js';
import { authenticate } from './authenticate.js';

/**
 * Determines whether a non-empty Authorization header was supplied.
 *
 * Detailed Bearer-token validation remains the responsibility of the existing
 * JWT authentication middleware.
 *
 * @param {import('express').Request} req Express request.
 * @returns {boolean} True when an Authorization header is present.
 */
function hasAuthorizationHeader(req) {
  const authorization = req.headers.authorization;

  return typeof authorization === 'string' && authorization.length > 0;
}

/**
 * Determines whether a non-empty X-API-Key header was supplied.
 *
 * Credential format and validity remain the responsibility of the API-key
 * authentication middleware.
 *
 * @param {import('express').Request} req Express request.
 * @returns {boolean} True when an API-key header is present.
 */
function hasApiKeyHeader(req) {
  const apiKey = req.get('X-API-Key');

  return typeof apiKey === 'string' && apiKey.length > 0;
}

/**
 * Authenticates a request using JWT or API-key credentials.
 *
 * Selection policy:
 *
 * 1. Authorization header present → JWT authentication.
 * 2. Otherwise X-API-Key present → API-key authentication.
 * 3. Otherwise reject the request as unauthenticated.
 *
 * An invalid JWT never falls back to an API key, even when both credentials
 * are supplied. This keeps authentication intent explicit and predictable.
 *
 * Both underlying mechanisms populate the same `req.user` contract, allowing
 * downstream services and controllers to remain authentication-method
 * agnostic.
 *
 * @type {import('express').RequestHandler}
 */
export function authenticateAny(req, res, next) {
  if (hasAuthorizationHeader(req)) {
    return authenticate(req, res, next);
  }

  if (hasApiKeyHeader(req)) {
    return authenticateApiKey(req, res, next);
  }

  return next(
    new AppError('Authentication is required.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'AUTHENTICATION_REQUIRED',
    }),
  );
}
