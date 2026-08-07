/**
 * @file worker.validation.test.js
 * @description Unit tests for DispatchIQ Worker Management API validation.
 *
 * These tests verify pagination coercion, defaults, lifecycle-status
 * validation, unsupported input stripping, limits, and worker UUID
 * validation independently of Express middleware.
 */

import { describe, expect, it } from 'vitest';

import { listWorkersQuerySchema, workerIdParamsSchema } from './worker.validation.js';

describe('worker validation', () => {
  describe('listWorkersQuerySchema', () => {
    it('applies pagination defaults when query parameters are omitted', () => {
      const result = listWorkersQuerySchema.parse({});

      expect(result).toEqual({
        page: 1,
        limit: 20,
      });
    });

    it('coerces pagination query strings into numbers', () => {
      const result = listWorkersQuerySchema.parse({
        page: '3',
        limit: '25',
      });

      expect(result).toEqual({
        page: 3,
        limit: 25,
      });
    });

    it('accepts every supported worker lifecycle status', () => {
      const statuses = ['STARTING', 'ONLINE', 'BUSY', 'UNHEALTHY', 'OFFLINE', 'STOPPING'];

      for (const status of statuses) {
        expect(
          listWorkersQuerySchema.parse({
            status,
          }),
        ).toEqual({
          page: 1,
          limit: 20,
          status,
        });
      }
    });

    it('rejects an unsupported worker lifecycle status', () => {
      const result = listWorkersQuerySchema.safeParse({
        status: 'CRASHED',
      });

      expect(result.success).toBe(false);
    });

    it('rejects page zero', () => {
      const result = listWorkersQuerySchema.safeParse({
        page: '0',
      });

      expect(result.success).toBe(false);
    });

    it('rejects negative page numbers', () => {
      const result = listWorkersQuerySchema.safeParse({
        page: '-1',
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-integer page numbers', () => {
      const result = listWorkersQuerySchema.safeParse({
        page: '1.5',
      });

      expect(result.success).toBe(false);
    });

    it('rejects limit zero', () => {
      const result = listWorkersQuerySchema.safeParse({
        limit: '0',
      });

      expect(result.success).toBe(false);
    });

    it('rejects limits greater than 100', () => {
      const result = listWorkersQuerySchema.safeParse({
        limit: '101',
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-numeric pagination values', () => {
      const result = listWorkersQuerySchema.safeParse({
        page: 'abc',
        limit: 'xyz',
      });

      expect(result.success).toBe(false);
    });

    it('strips unsupported query properties', () => {
      const result = listWorkersQuerySchema.parse({
        page: '1',
        limit: '20',
        status: 'ONLINE',
        internalOnly: 'true',
      });

      expect(result).toEqual({
        page: 1,
        limit: 20,
        status: 'ONLINE',
      });

      expect(result).not.toHaveProperty('internalOnly');
    });
  });

  describe('workerIdParamsSchema', () => {
    it('accepts a valid worker UUID', () => {
      const workerId = '123e4567-e89b-12d3-a456-426614174000';

      const result = workerIdParamsSchema.parse({
        workerId,
      });

      expect(result).toEqual({
        workerId,
      });
    });

    it('rejects a malformed worker identifier', () => {
      const result = workerIdParamsSchema.safeParse({
        workerId: 'worker-123',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an empty worker identifier', () => {
      const result = workerIdParamsSchema.safeParse({
        workerId: '',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a missing worker identifier', () => {
      const result = workerIdParamsSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('strips unsupported route parameters', () => {
      const workerId = '123e4567-e89b-12d3-a456-426614174000';

      const result = workerIdParamsSchema.parse({
        workerId,
        unexpected: 'value',
      });

      expect(result).toEqual({
        workerId,
      });
    });
  });
});
