/**
 * @file rate-limit.test.js
 * @description Unit and middleware-level tests for DispatchIQ HTTP
 * rate-limiting policies.
 *
 * Tests exercise the limiter through isolated Express applications so quota
 * enforcement, response contracts, request correlation, successful-request
 * skipping, and configuration validation are verified independently of
 * application routes.
 */

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createRateLimiter } from './rate-limit.js';

/**
 * Creates an isolated Express application containing a supplied limiter.
 *
 * @param {import('express').RequestHandler} limiter Rate-limit middleware.
 * @param {number} [statusCode=200] Test-route response status.
 * @returns {import('express').Express} Test Express application.
 */
function createTestApp(limiter, statusCode = 200) {
  const app = express();

  app.use((req, res, next) => {
    req.requestId = 'request-rate-limit-test';

    res.locals.requestId = 'request-rate-limit-test';

    next();
  });

  app.use(limiter);

  app.get('/test', (_req, res) => {
    return res.status(statusCode).json({
      success: statusCode < 400,
    });
  });

  return app;
}

describe('rate limiting', () => {
  describe('createRateLimiter', () => {
    it('allows requests while quota remains available', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 2,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
      });

      const app = createTestApp(limiter);

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        success: true,
      });
    });

    it('rejects requests after the configured limit is exceeded', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 2,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
      });

      const app = createTestApp(limiter);

      await request(app).get('/test');
      await request(app).get('/test');

      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
    });

    it('returns the standard DispatchIQ error response', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 1,
        code: 'CUSTOM_RATE_LIMIT',
        message: 'Custom rate limit exceeded.',
      });

      const app = createTestApp(limiter);

      await request(app).get('/test');

      const response = await request(app).get('/test');

      expect(response.body).toEqual({
        success: false,

        error: {
          code: 'CUSTOM_RATE_LIMIT',
          message: 'Custom rate limit exceeded.',
          requestId: 'request-rate-limit-test',
        },
      });
    });

    it('includes standards-based rate-limit headers', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 5,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
      });

      const response = await request(createTestApp(limiter)).get('/test');

      expect(response.headers).toHaveProperty('ratelimit');
    });

    it('does not expose deprecated X-RateLimit headers', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 5,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
      });

      const response = await request(createTestApp(limiter)).get('/test');

      expect(response.headers).not.toHaveProperty('x-ratelimit-limit');
    });

    it('can exclude successful responses from the quota', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 1,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
        skipSuccessfulRequests: true,
      });

      const app = createTestApp(limiter);

      const first = await request(app).get('/test');

      const second = await request(app).get('/test');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
    });

    it('continues counting failed responses when successful requests are skipped', async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        limit: 1,
        code: 'TEST_RATE_LIMIT',
        message: 'Rate limit exceeded.',
        skipSuccessfulRequests: true,
      });

      const app = createTestApp(limiter, 401);

      const first = await request(app).get('/test');

      const second = await request(app).get('/test');

      expect(first.status).toBe(401);
      expect(second.status).toBe(429);
    });

    it('rejects an invalid rate-limit window', () => {
      expect(() =>
        createRateLimiter({
          windowMs: 0,
          limit: 10,
          code: 'TEST',
          message: 'Test.',
        }),
      ).toThrow('Rate limiter windowMs must be a positive integer.');
    });

    it('rejects an invalid request limit', () => {
      expect(() =>
        createRateLimiter({
          windowMs: 60_000,
          limit: 0,
          code: 'TEST',
          message: 'Test.',
        }),
      ).toThrow('Rate limiter limit must be a positive integer.');
    });

    it('rejects an empty error code', () => {
      expect(() =>
        createRateLimiter({
          windowMs: 60_000,
          limit: 10,
          code: '',
          message: 'Test.',
        }),
      ).toThrow('Rate limiter code must be a non-empty string.');
    });

    it('rejects an empty error message', () => {
      expect(() =>
        createRateLimiter({
          windowMs: 60_000,
          limit: 10,
          code: 'TEST',
          message: '',
        }),
      ).toThrow('Rate limiter message must be a non-empty string.');
    });
  });
});
