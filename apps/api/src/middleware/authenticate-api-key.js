/**
 * @file authenticate-api-key.js
 * @description Authenticates DispatchIQ requests using the X-API-Key header.
 *
 * API-key authentication is intended for programmatic clients such as CI
 * pipelines, backend services, and automation tools.
 *
 * Raw API keys are never stored. Incoming credentials are structurally
 * validated, hashed with SHA-256, matched against the persisted key hash, and
 * rejected when unknown or revoked. Successful authentication resolves the
 * owning user and attaches safe authentication context to the request.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { hashApiKey, isApiKeyFormatValid } from '../api-keys/api-key.crypto.js';
import { findApiKeyByHash, touchApiKeyLastUsed } from '../api-keys/api-key.repository.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Extracts one API key from the X-API-Key request header.
 *
 * Express normalizes request-header names to lowercase, but `req.get()` keeps
 * the middleware independent of that implementation detail.
 *
 * Duplicate or non-string header values are treated as invalid credentials
 * rather than attempting to guess which value the client intended.
 *
 * @param {import('express').Request} req Express request.
 * @returns {string | null} Raw API key or null when absent/invalid.
 */
function extractApiKey(req) {
  const value = req.get('X-API-Key');

  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  return value;
}

/**
 * Authenticates a request using a DispatchIQ API key.
 *
 * Authentication flow:
 *
 * 1. Read the X-API-Key header.
 * 2. Verify the credential's structural format.
 * 3. Hash the raw credential using SHA-256.
 * 4. Resolve the persisted API-key record and owning user.
 * 5. Reject unknown or revoked credentials.
 * 6. Update the key's last-used timestamp.
 * 7. Expose safe user and API-key context to downstream middleware.
 *
 * The raw key and stored key hash are never attached to the request object.
 *
 * @type {import('express').RequestHandler}
 */
export const authenticateApiKey = asyncHandler(async (req, res, next) => {
  void res;

  const rawApiKey = extractApiKey(req);

  if (!rawApiKey) {
    throw new AppError('API key authentication is required.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'API_KEY_REQUIRED',
    });
  }

  if (!isApiKeyFormatValid(rawApiKey)) {
    throw new AppError('API key is invalid.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_API_KEY',
    });
  }

  const keyHash = hashApiKey(rawApiKey);
  const apiKey = await findApiKeyByHash(keyHash);

  /*
   * Unknown and revoked keys intentionally share the same public error. This
   * prevents clients from discovering whether a specific credential once
   * existed or has merely been disabled.
   */
  if (!apiKey || apiKey.revokedAt) {
    throw new AppError('API key is invalid.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_API_KEY',
    });
  }

  const usedAt = new Date();

  const usageUpdate = await touchApiKeyLastUsed({
    apiKeyId: apiKey.id,
    usedAt,
  });

  /*
   * Revocation may race with authentication after the lookup above. Requiring
   * the conditional last-used update to succeed prevents a concurrently
   * revoked key from being accepted by a stale request.
   */
  if (usageUpdate.count !== 1) {
    throw new AppError('API key is invalid.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_API_KEY',
    });
  }

  req.user = apiKey.user;

  /*
   * Safe credential metadata allows later middleware, audit logging, or
   * request attribution to identify which key authenticated the request
   * without exposing credential material.
   */
  req.apiKey = {
    id: apiKey.id,
    name: apiKey.name,
    lastUsedAt: usedAt,
    createdAt: apiKey.createdAt,
  };

  next();
});
