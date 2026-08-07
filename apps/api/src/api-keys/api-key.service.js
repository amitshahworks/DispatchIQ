/**
 * @file api-key.service.js
 * @description Business logic for DispatchIQ API-key management.
 *
 * The service coordinates API-key generation, hashing, persistence, safe
 * listing, and revocation.
 *
 * Raw API keys are intentionally returned only during creation. Subsequent
 * management operations expose metadata only. Stored hashes remain confined
 * to the repository and are never returned through this service.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';
import { generateApiKey, hashApiKey } from './api-key.crypto.js';
import {
  createApiKey as createApiKeyRecord,
  findApiKeyByIdForUser,
  findApiKeysForUser,
  revokeApiKey as revokeApiKeyRecord,
} from './api-key.repository.js';

/**
 * Creates a new API key for an authenticated user.
 *
 * A cryptographically secure raw credential is generated, hashed using
 * SHA-256, and only the hash is persisted. The raw credential is returned in
 * the response exactly once so the caller can store it securely.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {{ name: string }} input Validated API-key creation input.
 * @returns {Promise<{
 *   apiKey: {
 *     id: string,
 *     userId: string,
 *     name: string,
 *     lastUsedAt: Date | null,
 *     revokedAt: Date | null,
 *     createdAt: Date
 *   },
 *   key: string
 * }>} Created API-key metadata and one-time raw credential.
 */
export async function createApiKey(userId, input) {
  const rawApiKey = generateApiKey();
  const keyHash = hashApiKey(rawApiKey);

  const apiKey = await createApiKeyRecord({
    userId,
    name: input.name,
    keyHash,
  });

  return {
    apiKey,
    key: rawApiKey,
  };
}

/**
 * Returns API-key metadata owned by an authenticated user.
 *
 * Repository projections already exclude stored hashes, and raw credentials
 * cannot be reconstructed from those hashes.
 *
 * @param {string} userId Authenticated user identifier.
 * @returns {Promise<Array<{
 *   id: string,
 *   userId: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * }>>} Safe API-key metadata ordered newest first.
 */
export function listApiKeys(userId) {
  return findApiKeysForUser(userId);
}

/**
 * Revokes one API key owned by the authenticated user.
 *
 * Unknown keys, keys belonging to another user, and already-revoked keys are
 * intentionally represented using the same not-found response. This avoids
 * leaking API-key ownership or lifecycle state across accounts.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {string} apiKeyId API-key identifier.
 * @param {Date} [revokedAt=new Date()] Revocation timestamp.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * }>} API-key metadata as it existed before revocation.
 * @throws {AppError} When no active user-owned API key can be revoked.
 */
export async function revokeApiKey(userId, apiKeyId, revokedAt = new Date()) {
  const apiKey = await findApiKeyByIdForUser({
    apiKeyId,
    userId,
  });

  if (!apiKey || apiKey.revokedAt) {
    throw new AppError('API key was not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'API_KEY_NOT_FOUND',
    });
  }

  const result = await revokeApiKeyRecord({
    apiKeyId,
    userId,
    revokedAt,
  });

  /*
   * A conditional update count of zero means the key changed state after the
   * ownership lookup, for example because another request revoked it first.
   * Treat that race identically to an already-unavailable key.
   */
  if (result.count !== 1) {
    throw new AppError('API key was not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'API_KEY_NOT_FOUND',
    });
  }

  return {
    ...apiKey,
    revokedAt,
  };
}
