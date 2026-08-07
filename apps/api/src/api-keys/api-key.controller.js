/**
 * @file api-key.controller.js
 * @description HTTP controllers for DispatchIQ API-key management.
 *
 * Controllers translate validated HTTP requests into service calls and return
 * consistent API responses. API-key generation, hashing, ownership rules, and
 * revocation behavior remain in the service and repository layers.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { createApiKey, listApiKeys, revokeApiKey } from './api-key.service.js';

/**
 * Creates an API key for the authenticated user.
 *
 * The raw credential is included only in this creation response. Clients must
 * store it securely because it cannot be retrieved again.
 *
 * @type {import('express').RequestHandler}
 */
export const createApiKeyController = asyncHandler(async (req, res) => {
  const result = await createApiKey(req.user.id, req.body);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    data: result,
  });
});

/**
 * Returns safe metadata for all API keys owned by the authenticated user.
 *
 * Stored hashes and raw credentials are never exposed.
 *
 * @type {import('express').RequestHandler}
 */
export const listApiKeysController = asyncHandler(async (req, res) => {
  const apiKeys = await listApiKeys(req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: apiKeys,
  });
});

/**
 * Revokes one API key owned by the authenticated user.
 *
 * @type {import('express').RequestHandler}
 */
export const revokeApiKeyController = asyncHandler(async (req, res) => {
  const apiKey = await revokeApiKey(req.user.id, req.params.apiKeyId);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: apiKey,
  });
});
