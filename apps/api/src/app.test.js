/**
 * Integration tests for the DispatchIQ Express application foundation.
 *
 * The database package is mocked so API tests remain deterministic and do
 * not require a running PostgreSQL container.
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

const { app } = await import('./app.js');

describe('DispatchIQ API foundation', () => {
  beforeEach(() => {
    checkDatabaseHealthMock.mockReset();
  });

  describe('GET /', () => {
    it('returns API service information', async () => {
      const response = await request(app).get('/');

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

      const response = await request(app).get('/health');

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

      const response = await request(app).get('/health');

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
      const response = await request(app).get('/missing');

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
      const response = await request(app)
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
});
