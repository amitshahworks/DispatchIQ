/**
 * @file auth.tokens.js
 * @description Creates and verifies short-lived JWT access tokens for
 * DispatchIQ authentication. This module handles access tokens only; refresh
 * tokens are opaque random values managed separately.
 */

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

/**
 * Creates a signed access token for an authenticated user.
 *
 * The user ID is stored in the standard JWT `sub` claim. Only the user's role
 * is included in the custom payload to keep the token small and avoid exposing
 * unnecessary account information.
 *
 * @param {{ userId: string, role: string }} payload Authenticated user claims.
 * @returns {string} Signed JWT access token.
 */
export function generateAccessToken({ userId, role }) {
  return jwt.sign(
    {
      role,
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      subject: userId,
    },
  );
}

/**
 * Verifies an access token and returns its authenticated claims.
 *
 * Signature, algorithm, and expiration validation are delegated to
 * `jsonwebtoken`. Invalid, malformed, or expired tokens cause this function
 * to throw so authentication middleware can convert the failure into the
 * appropriate HTTP response.
 *
 * @param {string} token JWT access token supplied by the client.
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 * Verified token claims.
 * @throws {Error} When the token is invalid, malformed, expired, or missing
 * required claims.
 */
export function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
  });

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.role !== 'string'
  ) {
    throw new Error('Access token contains invalid claims.');
  }

  return decoded;
}
