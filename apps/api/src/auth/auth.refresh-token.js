/**
 * @file auth.refresh-token.js
 * @description Generates, hashes, and expires opaque refresh tokens used by
 * DispatchIQ authentication. Raw refresh tokens are returned to clients, while
 * only SHA-256 hashes are persisted in the database.
 */

import { createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env.js';

const REFRESH_TOKEN_BYTE_LENGTH = 48;

/**
 * Generates a cryptographically secure opaque refresh token.
 *
 * The token is encoded as hexadecimal text so it can be transferred safely in
 * JSON request and response bodies.
 *
 * @returns {string} Newly generated raw refresh token.
 */
export function generateRefreshToken() {
  return randomBytes(REFRESH_TOKEN_BYTE_LENGTH).toString('hex');
}

/**
 * Produces a deterministic SHA-256 hash for a raw refresh token.
 *
 * Only this hash should be stored in PostgreSQL. The raw token must never be
 * logged or persisted by the server.
 *
 * @param {string} token Raw refresh token supplied by the client.
 * @returns {string} Hexadecimal SHA-256 token hash.
 */
export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Calculates the expiration timestamp for a newly issued refresh token.
 *
 * @param {Date} [issuedAt=new Date()] Token issue time.
 * @returns {Date} Refresh-token expiration timestamp.
 */
export function calculateRefreshTokenExpiry(issuedAt = new Date()) {
  const expiresAt = new Date(issuedAt);

  expiresAt.setUTCDate(expiresAt.getUTCDate() + env.REFRESH_TOKEN_EXPIRES_DAYS);

  return expiresAt;
}
