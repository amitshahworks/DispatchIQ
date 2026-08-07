/**
 * @file api-key.repository.js
 * @description Prisma data-access operations for DispatchIQ API-key
 * management and authentication.
 *
 * Raw API keys are never persisted. This repository stores and queries only
 * SHA-256 hashes and exposes safe projections for normal API-key management
 * responses.
 *
 * Ownership-sensitive mutations always include `userId` in their database
 * filters to prevent one user from modifying another user's API keys.
 */

import { prisma } from '@dispatchiq/database';

/**
 * Creates a new hashed API key for a user.
 *
 * The raw credential must already have been generated and hashed by the
 * service layer. The repository persists only the hash and returns a safe
 * projection that excludes `keyHash`.
 *
 * @param {{
 *   userId: string,
 *   name: string,
 *   keyHash: string
 * }} data API-key persistence data.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * }>} Safe created API-key record.
 */
export function createApiKey({ userId, name, keyHash }) {
  return prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash,
    },
    select: {
      id: true,
      userId: true,
      name: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Returns all API keys owned by a user.
 *
 * Key hashes are intentionally omitted because management endpoints do not
 * need credential material after creation.
 *
 * @param {string} userId User identifier.
 * @returns {Promise<Array<{
 *   id: string,
 *   userId: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * }>>} Safe user-owned API keys ordered newest first.
 */
export function findApiKeysForUser(userId) {
  return prisma.apiKey.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      userId: true,
      name: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Finds an API key by its stored SHA-256 hash for request authentication.
 *
 * Authentication requires both the key record and its owning user's current
 * safe account information. Revocation remains visible to the authentication
 * layer so it can reject inactive credentials explicitly.
 *
 * @param {string} keyHash SHA-256 API-key hash.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   keyHash: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date,
 *   user: {
 *     id: string,
 *     email: string,
 *     role: string,
 *     createdAt: Date,
 *     updatedAt: Date
 *   }
 * } | null>} API-key authentication record or null.
 */
export function findApiKeyByHash(keyHash) {
  return prisma.apiKey.findUnique({
    where: {
      keyHash,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

/**
 * Finds one user-owned API key by identifier.
 *
 * This lookup supports ownership-aware management operations without exposing
 * another user's key metadata.
 *
 * @param {{
 *   apiKeyId: string,
 *   userId: string
 * }} criteria Ownership-aware lookup criteria.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   name: string,
 *   lastUsedAt: Date | null,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * } | null>} Matching safe API-key record or null.
 */
export function findApiKeyByIdForUser({ apiKeyId, userId }) {
  return prisma.apiKey.findFirst({
    where: {
      id: apiKeyId,
      userId,
    },
    select: {
      id: true,
      userId: true,
      name: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Revokes an active API key owned by a user.
 *
 * `updateMany` is intentionally used so ownership and current revocation state
 * are checked atomically in one database statement. A count of zero means the
 * key was not found, was not owned by the user, or had already been revoked.
 *
 * @param {{
 *   apiKeyId: string,
 *   userId: string,
 *   revokedAt?: Date
 * }} data Revocation data.
 * @returns {Promise<{ count: number }>} Number of API keys revoked.
 */
export function revokeApiKey({ apiKeyId, userId, revokedAt = new Date() }) {
  return prisma.apiKey.updateMany({
    where: {
      id: apiKeyId,
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt,
    },
  });
}

/**
 * Updates the last-used timestamp for an active API key.
 *
 * The mutation is conditional on `revokedAt: null` so a revoked credential
 * cannot appear active again because of a late or concurrent request.
 *
 * @param {{
 *   apiKeyId: string,
 *   usedAt?: Date
 * }} data Usage timestamp data.
 * @returns {Promise<{ count: number }>} Number of API-key records updated.
 */
export function touchApiKeyLastUsed({ apiKeyId, usedAt = new Date() }) {
  return prisma.apiKey.updateMany({
    where: {
      id: apiKeyId,
      revokedAt: null,
    },
    data: {
      lastUsedAt: usedAt,
    },
  });
}
