/**
 * @file app.test.js
 * @description Integration tests for the DispatchIQ Express application
 * foundation and global API security middleware.
 *
 * The database package is mocked so tests remain deterministic and do not
 * require PostgreSQL. Global rate-limiter behavior itself is tested in
 * security/rate-limit.test.js; this suite verifies its integration into the
 * application middleware chain.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkDatabaseHealthMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  checkDatabaseHealth: checkDatabaseHealthMock,

  prisma: {
    $disconnect: vi.fn(),
  },
}));

const { createApp } = await import('./app.js');

describe('DispatchIQ API foundation', () => {
  beforeEach(() => {
    checkDatabaseHealthMock.mockReset();
  });

  describe('GET /', () => {
    it('returns API service information', async () => {
      const response = await request(createApp()).get('/');

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        success: true,

        data: {
          service: 'DispatchIQ API',
          status: 'ok',
          version: '1.0.0',
        },
      });
    });
  });

  describe('GET /health', () => {
    it('returns healthy when PostgreSQL is reachable', async () => {
      checkDatabaseHealthMock.mockResolvedValue(true);

      const response = await request(createApp()).get('/health');

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        success: true,

        data: {
          status: 'healthy',
          database: 'connected',
        },
      });
    });

    it('returns service unavailable when PostgreSQL is unreachable', async () => {
      checkDatabaseHealthMock.mockResolvedValue(false);

      const response = await request(createApp()).get('/health');

      expect(response.status).toBe(503);

      expect(response.body).toEqual({
        success: false,

        data: {
          status: 'unhealthy',
          database: 'disconnected',
        },
      });
    });
  });

  describe('unknown routes', () => {
    it('returns the standardized not-found response', async () => {
      const response = await request(createApp()).get('/missing');

      expect(response.status).toBe(404);

      expect(response.body).toEqual({
        success: false,

        error: {
          code: 'ROUTE_NOT_FOUND',
          message: 'Route GET /missing was not found.',
        },
      });
    });
  });

  describe('malformed JSON', () => {
    it('returns a standardized bad-request response', async () => {
      const response = await request(createApp())
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"invalidJson":');

      expect(response.status).toBe(400);

      expect(response.body).toEqual({
        success: false,

        error: {
          code: 'MALFORMED_JSON',
          message: 'Request body contains malformed JSON.',
        },
      });
    });
  });

  describe('global API rate limiting', () => {
    it('runs the global limiter before application routes', async () => {
      const rateLimiterMock = vi.fn((_req, _res, next) => next());

      const app = createApp({
        rateLimiter: rateLimiterMock,
      });

      const response = await request(app).get('/');

      expect(response.status).toBe(200);

      expect(rateLimiterMock).toHaveBeenCalledOnce();
    });

    it('prevents route execution when the global limiter rejects a request', async () => {
      const rateLimiterMock = vi.fn((req, res, _next) =>
        res.status(429).json({
          success: false,

          error: {
            code: 'API_RATE_LIMIT_EXCEEDED',

            message: 'Too many requests. Please try again shortly.',

            requestId: req.requestId,
          },
        }),
      );

      const app = createApp({
        rateLimiter: rateLimiterMock,
      });

      /*
       * Database health would normally be queried by /health. If this mock is
       * never invoked, the 429 response proves the limiter terminated the
       * request before the route handler executed.
       */
      checkDatabaseHealthMock.mockResolvedValue(true);

      const response = await request(app).get('/health');

      expect(response.status).toBe(429);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'API_RATE_LIMIT_EXCEEDED',

          message: 'Too many requests. Please try again shortly.',

          requestId: expect.any(String),
        },
      });

      expect(rateLimiterMock).toHaveBeenCalledOnce();

      expect(checkDatabaseHealthMock).not.toHaveBeenCalled();
    });

    it('assigns request correlation before the global limiter executes', async () => {
      let observedRequestId;

      const rateLimiterMock = vi.fn((req, _res, next) => {
        observedRequestId = req.requestId;

        next();
      });

      const app = createApp({
        rateLimiter: rateLimiterMock,
      });

      await request(app).get('/');

      expect(observedRequestId).toEqual(expect.any(String));

      expect(observedRequestId.length).toBeGreaterThan(0);
    });
  });
});
