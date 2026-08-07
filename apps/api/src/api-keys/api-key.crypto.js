/**
 * @file api-key.crypto.js
 * @description Cryptographic utilities for generating and hashing DispatchIQ
 * API keys.
 *
 * API keys are opaque credentials intended for programmatic access to the
 * DispatchIQ API. Raw keys are generated using cryptographically secure
 * randomness and are returned to the client only once during creation.
 *
 * DispatchIQ never stores raw API keys. Only a deterministic SHA-256 hash is
 * persisted so a database compromise does not immediately expose reusable
 * credentials.
 */

import { createHash, randomBytes } from 'node:crypto';

const API_KEY_PREFIX = 'diq_live_';
const API_KEY_SECRET_BYTES = 32;

/*
 * Node's base64url encoding represents 32 random bytes using 43 URL-safe
 * characters without padding.
 */
const API_KEY_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Generates a cryptographically secure DispatchIQ API key.
 *
 * The `diq_live_` prefix makes accidental credential exposure easier to
 * recognize in logs, configuration files, and secret-scanning systems while
 * the random component provides 256 bits of entropy.
 *
 * The returned credential must be shown to the user exactly once. Callers
 * should hash it before persistence and must never write the raw value to the
 * database or application logs.
 *
 * @returns {string} Newly generated raw API key.
 */
export function generateApiKey() {
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString('base64url');

  return `${API_KEY_PREFIX}${secret}`;
}

/**
 * Computes the deterministic SHA-256 hash used for API-key persistence and
 * authentication lookup.
 *
 * Hashing API keys differs from password hashing because generated API keys
 * already contain high cryptographic entropy. A fast cryptographic hash is
 * appropriate here and allows deterministic database lookup by credential.
 *
 * @param {string} apiKey Raw DispatchIQ API key.
 * @returns {string} Lowercase hexadecimal SHA-256 hash.
 * @throws {TypeError} When the supplied credential is not a non-empty string.
 */
export function hashApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new TypeError('API key must be a non-empty string.');
  }

  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/**
 * Determines whether a value follows the DispatchIQ API-key format.
 *
 * This performs structural validation only. A correctly formatted key is not
 * considered authenticated until its SHA-256 hash resolves to an active
 * database record.
 *
 * @param {unknown} apiKey Value to inspect.
 * @returns {boolean} True when the value matches the API-key format.
 */
export function isApiKeyFormatValid(apiKey) {
  if (typeof apiKey !== 'string') {
    return false;
  }

  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return false;
  }

  const secret = apiKey.slice(API_KEY_PREFIX.length);

  return API_KEY_SECRET_PATTERN.test(secret);
}
