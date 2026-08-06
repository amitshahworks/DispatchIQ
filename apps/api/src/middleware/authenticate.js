/**
 * @file authenticate.js
 * @description Verifies JWT access tokens and resolves the authenticated
 * DispatchIQ user for protected API routes.
 *
 * The middleware accepts access tokens through the standard Authorization
 * header, validates their signature and claims, confirms that the referenced
 * user still exists, and exposes safe user information through `req.user`.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { findUserById } from '../auth/auth.repository.js';
import { verifyAccessToken } from '../auth/auth.tokens.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Extracts a JWT from an Authorization header using the Bearer scheme.
 *
 * @param {string | undefined} authorizationHeader Raw Authorization header.
 * @returns {string | null} Access token, or null when the header is missing
 * or malformed.
 */
function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(\S+)$/i);

  return match?.[1] ?? null;
}

/**
 * Authenticates an incoming request using a JWT access token.
 *
 * On success, the middleware assigns a safe user object to `req.user`:
 *
 * ```js
 * {
 *   id,
 *   email,
 *   role,
 *   createdAt,
 *   updatedAt
 * }
 * ```
 *
 * @type {import('express').RequestHandler}
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    throw new AppError('Authentication is required.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'AUTHENTICATION_REQUIRED',
    });
  }

  let claims;

  try {
    claims = verifyAccessToken(token);
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      throw new AppError('Access token has expired.', HTTP_STATUS.UNAUTHORIZED, {
        code: 'ACCESS_TOKEN_EXPIRED',
      });
    }

    throw new AppError('Access token is invalid.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_ACCESS_TOKEN',
    });
  }

  const user = await findUserById(claims.sub);

  if (!user) {
    throw new AppError('Authenticated user is no longer available.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'AUTHENTICATED_USER_NOT_FOUND',
    });
  }

  req.user = user;

  next();
});
