/**
 * @file job.validation.test.js
 * @description Unit tests for DispatchIQ job request validation schemas.
 */

import { describe, expect, it } from 'vitest';

import { createJobSchema, jobIdParamsSchema, listJobsQuerySchema } from './job.validation.js';

describe('job validation schemas', () => {
  describe('createJobSchema', () => {
    it('accepts valid job input and applies defaults', () => {
      const result = createJobSchema.parse({
        type: 'EMAIL',
        payload: {
          to: 'amit@example.com',
          subject: 'DispatchIQ test',
        },
      });

      expect(result).toEqual({
        type: 'EMAIL',
        priority: 'MEDIUM',
        payload: {
          to: 'amit@example.com',
          subject: 'DispatchIQ test',
        },
        maxAttempts: 3,
      });
    });

    it('accepts all approved job types', () => {
      for (const type of ['EMAIL', 'WEBHOOK', 'REPORT_GENERATION']) {
        const result = createJobSchema.safeParse({
          type,
          payload: {
            test: true,
          },
        });

        expect(result.success).toBe(true);
      }
    });

    it('rejects an unsupported job type', () => {
      const result = createJobSchema.safeParse({
        type: 'CUSTOM',
        payload: {
          test: true,
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects an empty payload', () => {
      const result = createJobSchema.safeParse({
        type: 'EMAIL',
        payload: {},
      });

      expect(result.success).toBe(false);
    });

    it('normalizes a scheduled date into a Date instance', () => {
      const result = createJobSchema.parse({
        type: 'REPORT_GENERATION',
        payload: {
          report: 'monthly',
        },
        availableAt: '2026-08-10T09:00:00.000Z',
      });

      expect(result.availableAt).toBeInstanceOf(Date);
      expect(result.availableAt.toISOString()).toBe('2026-08-10T09:00:00.000Z');
    });

    it('rejects more than ten attempts', () => {
      const result = createJobSchema.safeParse({
        type: 'WEBHOOK',
        payload: {
          url: 'https://example.com/webhook',
        },
        maxAttempts: 11,
      });

      expect(result.success).toBe(false);
    });

    it('strips server-controlled fields', () => {
      const result = createJobSchema.parse({
        type: 'EMAIL',
        payload: {
          to: 'amit@example.com',
        },
        status: 'COMPLETED',
        attemptCount: 99,
        lockedByWorkerId: 'worker-123',
      });

      expect(result).not.toHaveProperty('status');
      expect(result).not.toHaveProperty('attemptCount');
      expect(result).not.toHaveProperty('lockedByWorkerId');
    });
  });

  describe('listJobsQuerySchema', () => {
    it('applies pagination defaults', () => {
      const result = listJobsQuerySchema.parse({});

      expect(result).toEqual({
        page: 1,
        limit: 20,
      });
    });

    it('coerces query-string pagination values', () => {
      const result = listJobsQuerySchema.parse({
        page: '2',
        limit: '25',
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(result).toEqual({
        page: 2,
        limit: 25,
        status: 'FAILED',
        type: 'WEBHOOK',
      });
    });

    it('rejects unsupported statuses', () => {
      const result = listJobsQuerySchema.safeParse({
        status: 'RUNNING',
      });

      expect(result.success).toBe(false);
    });

    it('rejects limits above one hundred', () => {
      const result = listJobsQuerySchema.safeParse({
        limit: '101',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('jobIdParamsSchema', () => {
    it('accepts a valid UUID job identifier', () => {
      const result = jobIdParamsSchema.parse({
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.jobId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('rejects an invalid job identifier', () => {
      const result = jobIdParamsSchema.safeParse({
        jobId: 'not-a-uuid',
      });

      expect(result.success).toBe(false);
    });
  });
});
