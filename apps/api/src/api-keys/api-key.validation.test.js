/**
 * @file api-key.validation.test.js
 * @description Unit tests for DispatchIQ API-key request validation.
 *
 * These tests verify accepted input, normalization behavior, length limits,
 * rejection of unexpected fields, and UUID route-parameter validation.
 */

import { describe, expect, it } from 'vitest';

import { apiKeyIdParamsSchema, createApiKeySchema } from './api-key.validation.js';

describe('API key validation', () => {
  describe('createApiKeySchema', () => {
    it('accepts a valid API-key name', () => {
      const result = createApiKeySchema.parse({
        name: 'CI deployment',
      });

      expect(result).toEqual({
        name: 'CI deployment',
      });
    });

    it('trims surrounding whitespace from the API-key name', () => {
      const result = createApiKeySchema.parse({
        name: '  Production deploy  ',
      });

      expect(result).toEqual({
        name: 'Production deploy',
      });
    });

    it('accepts a name at the maximum allowed length', () => {
      const name = 'a'.repeat(100);

      expect(
        createApiKeySchema.parse({
          name,
        }),
      ).toEqual({
        name,
      });
    });

    it('rejects a missing API-key name', () => {
      const result = createApiKeySchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects an empty API-key name', () => {
      const result = createApiKeySchema.safeParse({
        name: '',
      });

      expect(result.success).toBe(false);

      expect(result.error.issues[0].message).toBe('API key name cannot be empty.');
    });

    it('rejects a whitespace-only API-key name', () => {
      const result = createApiKeySchema.safeParse({
        name: '   ',
      });

      expect(result.success).toBe(false);

      expect(result.error.issues[0].message).toBe('API key name cannot be empty.');
    });

    it('rejects API-key names longer than 100 characters', () => {
      const result = createApiKeySchema.safeParse({
        name: 'a'.repeat(101),
      });

      expect(result.success).toBe(false);

      expect(result.error.issues[0].message).toBe('API key name cannot exceed 100 characters.');
    });

    it.each([null, 123, true, {}, []])('rejects non-string API-key name %#', (name) => {
      const result = createApiKeySchema.safeParse({
        name,
      });

      expect(result.success).toBe(false);
    });

    it('strips unexpected server-controlled fields', () => {
      const result = createApiKeySchema.parse({
        name: 'CLI',
        keyHash: 'must-not-be-accepted',
        revokedAt: '2026-08-07T10:00:00.000Z',
        lastUsedAt: '2026-08-07T10:00:00.000Z',
        userId: 'other-user',
      });

      expect(result).toEqual({
        name: 'CLI',
      });
    });
  });

  describe('apiKeyIdParamsSchema', () => {
    it('accepts a valid API-key UUID', () => {
      const apiKeyId = '550e8400-e29b-41d4-a716-446655440000';

      expect(
        apiKeyIdParamsSchema.parse({
          apiKeyId,
        }),
      ).toEqual({
        apiKeyId,
      });
    });

    it.each(['', 'key-123', '550e8400-e29b-41d4-a716', 'not-a-uuid'])(
      'rejects invalid API-key identifier %s',
      (apiKeyId) => {
        const result = apiKeyIdParamsSchema.safeParse({
          apiKeyId,
        });

        expect(result.success).toBe(false);

        expect(result.error.issues[0].message).toBe('apiKeyId must be a valid UUID.');
      },
    );

    it('rejects a missing API-key identifier', () => {
      const result = apiKeyIdParamsSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });
});
