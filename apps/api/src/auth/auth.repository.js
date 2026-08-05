/**
 * @file auth.repository.js
 * @description Database access layer for DispatchIQ authentication.
 *
 * This module contains Prisma queries only. It does not perform password
 * hashing, token generation, HTTP validation, or authentication business
 * decisions. Those responsibilities belong to the service and controller
 * layers.
 */

import { prisma } from '@dispatchiq/database';

/**
 * Finds a user by normalized email address.
 *
 * @param {string} email Normalized user email.
 * @returns {Promise<{
 *   id: string,
 *   email: string,
 *   passwordHash: string,
 *   role: string,
 *   createdAt: Date,
 *   updatedAt: Date
 * } | null>} Matching user or null.
 */
export function findUserByEmail(email) {
  return prisma.user.findUnique({
    where: {
      email,
    },
  });
}

/**
 * Finds a user by ID and returns only fields safe for authenticated responses.
 *
 * @param {string} userId User identifier.
 * @returns {Promise<{
 *   id: string,
 *   email: string,
 *   role: string,
 *   createdAt: Date,
 *   updatedAt: Date
 * } | null>} Safe user record or null.
 */
export function findUserById(userId) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Creates a new standard user account.
 *
 * The repository fixes the role to USER so registration input can never assign
 * privileged roles such as ADMIN.
 *
 * @param {{ email: string, passwordHash: string }} data User creation data.
 * @returns {Promise<{
 *   id: string,
 *   email: string,
 *   role: string,
 *   createdAt: Date,
 *   updatedAt: Date
 * }>} Safe created user record.
 */
export function createUser({ email, passwordHash }) {
  return prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'USER',
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Stores a hashed refresh token for a user.
 *
 * @param {{
 *   userId: string,
 *   tokenHash: string,
 *   expiresAt: Date
 * }} data Refresh-token persistence data.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   tokenHash: string,
 *   expiresAt: Date,
 *   revokedAt: Date | null,
 *   createdAt: Date
 * }>} Created refresh-token record.
 */
export function storeRefreshToken({ userId, tokenHash, expiresAt }) {
  return prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
}

/**
 * Finds a refresh-token record by its stored SHA-256 hash.
 *
 * The related user is selected because refresh-token rotation needs the
 * current user's ID and role when issuing a replacement access token.
 *
 * @param {string} tokenHash Hashed refresh token.
 * @returns {Promise<{
 *   id: string,
 *   userId: string,
 *   tokenHash: string,
 *   expiresAt: Date,
 *   revokedAt: Date | null,
 *   createdAt: Date,
 *   user: {
 *     id: string,
 *     email: string,
 *     role: string,
 *     createdAt: Date,
 *     updatedAt: Date
 *   }
 * } | null>} Refresh-token record with its user, or null.
 */
export function findRefreshToken(tokenHash) {
  return prisma.refreshToken.findUnique({
    where: {
      tokenHash,
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
 * Revokes an active refresh token by setting its revocation timestamp.
 *
 * The update is conditional so already-revoked or unknown tokens are left
 * unchanged, which supports idempotent logout behavior.
 *
 * @param {string} tokenHash Hashed refresh token.
 * @param {Date} [revokedAt=new Date()] Revocation timestamp.
 * @returns {Promise<{ count: number }>} Number of active records revoked.
 */
export function revokeRefreshToken(tokenHash, revokedAt = new Date()) {
  return prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt,
    },
  });
}

/**
 * Revokes all active refresh tokens issued to a user.
 *
 * This operation can support future security actions such as password changes,
 * account compromise recovery, or administrative session invalidation.
 *
 * @param {string} userId User identifier.
 * @param {Date} [revokedAt=new Date()] Revocation timestamp.
 * @returns {Promise<{ count: number }>} Number of active tokens revoked.
 */
export function revokeAllRefreshTokens(userId, revokedAt = new Date()) {
  return prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: {
      revokedAt,
    },
  });
}

/**
 * Deletes expired refresh-token records.
 *
 * This is a maintenance operation and is not required during every
 * authentication request.
 *
 * @param {Date} [now=new Date()] Expiration cutoff.
 * @returns {Promise<{ count: number }>} Number of expired records deleted.
 */
export function deleteExpiredRefreshTokens(now = new Date()) {
  return prisma.refreshToken.deleteMany({
    where: {
      expiresAt: {
        lte: now,
      },
    },
  });
}
