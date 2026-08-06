/**
 * @file email.handler.test.js
 * @description Unit tests for the simulated DispatchIQ EMAIL handler.
 */

import { describe, expect, it, vi } from 'vitest';

import { createEmailHandler, validateEmailPayload } from './email.handler.js';

describe('email handler', () => {
  describe('validateEmailPayload', () => {
    it('normalizes a valid email payload', () => {
      expect(
        validateEmailPayload({
          to: '  amit@example.com  ',
          subject: '  Welcome to DispatchIQ  ',
          body: 'Hello Amit',
        }),
      ).toEqual({
        to: 'amit@example.com',
        subject: 'Welcome to DispatchIQ',
        body: 'Hello Amit',
      });
    });

    it('accepts a payload without an optional body', () => {
      expect(
        validateEmailPayload({
          to: 'amit@example.com',
          subject: 'Welcome',
        }),
      ).toEqual({
        to: 'amit@example.com',
        subject: 'Welcome',
      });
    });

    it('rejects a non-object payload', () => {
      expect(() => validateEmailPayload(null)).toThrow('EMAIL job payload must be an object.');
    });

    it.each(['', 'invalid-address', 123, undefined])('rejects invalid recipient value %s', (to) => {
      expect(() =>
        validateEmailPayload({
          to,
          subject: 'Welcome',
        }),
      ).toThrow('EMAIL job payload requires a valid "to" address.');
    });

    it('rejects an empty subject', () => {
      expect(() =>
        validateEmailPayload({
          to: 'amit@example.com',
          subject: '   ',
        }),
      ).toThrow('EMAIL job payload requires a non-empty "subject".');
    });

    it('rejects a non-string body', () => {
      expect(() =>
        validateEmailPayload({
          to: 'amit@example.com',
          subject: 'Welcome',
          body: {
            message: 'Hello',
          },
        }),
      ).toThrow('EMAIL job payload "body" must be a string when provided.');
    });
  });

  describe('createEmailHandler', () => {
    it('simulates email delivery and returns execution metadata', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const handler = createEmailHandler({
        delayMs: 50,
        sleepFn,
      });

      const result = await handler({
        id: 'job-123',
        payload: {
          to: 'amit@example.com',
          subject: 'DispatchIQ test',
        },
      });

      expect(sleepFn).toHaveBeenCalledWith(50);

      expect(result).toEqual({
        jobId: 'job-123',
        type: 'EMAIL',
        provider: 'SIMULATED',
        recipient: 'amit@example.com',
        delivered: true,
      });
    });

    it('rejects a missing job object', async () => {
      const handler = createEmailHandler({
        sleepFn: vi.fn(),
      });

      await expect(handler(null)).rejects.toThrow('EMAIL handler requires a job object.');
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid simulated delay %s', (delayMs) => {
      expect(() =>
        createEmailHandler({
          delayMs,
        }),
      ).toThrow('EMAIL handler delayMs must be a non-negative integer.');
    });

    it('rejects an invalid sleep dependency', () => {
      expect(() =>
        createEmailHandler({
          sleepFn: null,
        }),
      ).toThrow('EMAIL handler requires a sleep function.');
    });
  });
});
