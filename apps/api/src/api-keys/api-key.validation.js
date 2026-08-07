/**
 * @file api-key.validation.js
 * @description Zod schemas for DispatchIQ API-key management requests.
 *
 * These schemas validate and normalize client-controlled API-key management
 * input. API-key generation, hashing, ownership checks, revocation rules, and
 * persistence remain responsibilities of the service and repository layers.
 */

import { z } from 'zod';

/**
 * Validates API-key creation input.
 *
 * Names are user-facing identifiers intended to help users distinguish keys
 * such as CI pipelines, local development environments, or external services.
 */
export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'API key name cannot be empty.')
    .max(100, 'API key name cannot exceed 100 characters.'),
});

/**
 * Validates an API-key identifier supplied through route parameters.
 */
export const apiKeyIdParamsSchema = z.object({
  apiKeyId: z.uuid('apiKeyId must be a valid UUID.'),
});
