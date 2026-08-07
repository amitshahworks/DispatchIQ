/**
 * @file api-key.routes.js
 * @description Express routes for authenticated DispatchIQ API-key
 * management.
 *
 * API-key management itself requires JWT authentication. Raw API keys are
 * created, listed as safe metadata, and revoked only for the authenticated
 * owner. Request validation runs before controllers so downstream layers
 * receive normalized body and route-parameter data.
 */

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  createApiKeyController,
  listApiKeysController,
  revokeApiKeyController,
} from './api-key.controller.js';
import { apiKeyIdParamsSchema, createApiKeySchema } from './api-key.validation.js';

export const apiKeyRouter = Router();

apiKeyRouter.use(authenticate);

/**
 * Creates a new API key for the authenticated user.
 *
 * The raw credential is returned only by the creation response and cannot be
 * retrieved again after the request completes.
 */
apiKeyRouter.post('/', validate(createApiKeySchema), createApiKeyController);

/**
 * Lists safe metadata for API keys owned by the authenticated user.
 */
apiKeyRouter.get('/', listApiKeysController);

/**
 * Revokes one API key owned by the authenticated user.
 */
apiKeyRouter.post(
  '/:apiKeyId/revoke',
  validate(apiKeyIdParamsSchema, 'params'),
  revokeApiKeyController,
);
