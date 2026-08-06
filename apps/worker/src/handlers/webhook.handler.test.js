/**
 * @file webhook.handler.test.js
 * @description Unit tests for the simulated DispatchIQ WEBHOOK handler.
 */

import { describe, expect, it, vi } from 'vitest';

import { createWebhookHandler, validateWebhookPayload } from './webhook.handler.js';

describe('webhook handler', () => {
  describe('validateWebhookPayload', () => {
    it('normalizes a valid webhook payload', () => {
      expect(
        validateWebhookPayload({
          url: 'https://example.com/events',
          method: 'post',
          body: {
            event: 'job.completed',
          },
        }),
      ).toEqual({
        url: 'https://example.com/events',
        method: 'POST',
        body: {
          event: 'job.completed',
        },
      });
    });

    it('uses POST as the default method', () => {
      expect(
        validateWebhookPayload({
          url: 'https://example.com/webhook',
        }),
      ).toEqual({
        url: 'https://example.com/webhook',
        method: 'POST',
      });
    });

    it('rejects a non-object payload', () => {
      expect(() => validateWebhookPayload(null)).toThrow('WEBHOOK job payload must be an object.');
    });

    it('rejects a missing URL', () => {
      expect(() => validateWebhookPayload({})).toThrow(
        'WEBHOOK job payload requires a non-empty "url".',
      );
    });

    it('rejects malformed URLs', () => {
      expect(() =>
        validateWebhookPayload({
          url: 'not-a-url',
        }),
      ).toThrow('WEBHOOK job payload requires a valid URL.');
    });

    it('rejects unsupported URL protocols', () => {
      expect(() =>
        validateWebhookPayload({
          url: 'ftp://example.com/file',
        }),
      ).toThrow('WEBHOOK URL must use the HTTP or HTTPS protocol.');
    });

    it('rejects unsupported HTTP methods', () => {
      expect(() =>
        validateWebhookPayload({
          url: 'https://example.com',
          method: 'OPTIONS',
        }),
      ).toThrow('WEBHOOK method "OPTIONS" is not supported.');
    });
  });

  describe('createWebhookHandler', () => {
    it('simulates an outbound webhook request', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const handler = createWebhookHandler({
        delayMs: 75,
        sleepFn,
      });

      const result = await handler({
        id: 'job-123',
        payload: {
          url: 'https://example.com/events',
          method: 'PATCH',
        },
      });

      expect(sleepFn).toHaveBeenCalledWith(75);

      expect(result).toEqual({
        jobId: 'job-123',
        type: 'WEBHOOK',
        transport: 'SIMULATED',
        url: 'https://example.com/events',
        method: 'PATCH',
        statusCode: 200,
      });
    });

    it('rejects a missing job object', async () => {
      const handler = createWebhookHandler({
        sleepFn: vi.fn(),
      });

      await expect(handler(undefined)).rejects.toThrow('WEBHOOK handler requires a job object.');
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid simulated delay %s', (delayMs) => {
      expect(() =>
        createWebhookHandler({
          delayMs,
        }),
      ).toThrow('WEBHOOK handler delayMs must be a non-negative integer.');
    });

    it('rejects an invalid sleep dependency', () => {
      expect(() =>
        createWebhookHandler({
          sleepFn: 'invalid',
        }),
      ).toThrow('WEBHOOK handler requires a sleep function.');
    });
  });
});
