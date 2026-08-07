/**
 * @file metrics.routes.test.js
 * @description Route-level tests for the DispatchIQ platform metrics API.
 *
 * Authentication, authorization, and controller dependencies are mocked so
 * these tests verify routing behavior, middleware ordering, access control,
 * and controller delegation independently of JWT verification, database
 * queries, and metrics calculations.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const authorizeMiddlewareMock = vi.fn();
const authorizeMock = vi.fn(() => authorizeMiddlewareMock);
const getPlatformMetricsControllerMock = vi.fn();

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../middleware/authorize.js', () => ({
  authorize: authorizeMock,
}));

vi.mock('./metrics.controller.js', () => ({
  getPlatformMetricsController: getPlatformMetricsControllerMock,
}));

const { metricsRouter } = await import('./metrics.routes.js');

/**
 * Creates an isolated Express application containing only the metrics router.
 *
 * @returns {import('express').Express} Test application.
 */
function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use('/metrics', metricsRouter);

  /*
   * Minimal error boundary used by route tests so middleware failures produce
   * deterministic HTTP responses rather than terminating the request.
   */
  app.use((error, req, res, next) => {
    void req;
    void next;

    const statusCode = error.statusCode ?? error.status ?? 500;

    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  });

  return app;
}

describe('metrics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateMock.mockImplementation((req, res, next) => {
      void res;

      req.user = {
        id: 'admin-123',
        role: 'ADMIN',
      };

      next();
    });

    authorizeMiddlewareMock.mockImplementation((req, res, next) => {
      void req;
      void res;

      next();
    });

    getPlatformMetricsControllerMock.mockImplementation((req, res) => {
      void req;

      return res.status(200).json({
        success: true,
        data: {
          generatedAt: '2026-08-07T10:00:00.000Z',
        },
      });
    });
  });

  describe('GET /metrics', () => {
    it('runs authentication before authorization and the controller', async () => {
      const executionOrder = [];

      authenticateMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('authenticate');

        req.user = {
          id: 'admin-123',
          role: 'ADMIN',
        };

        next();
      });

      authorizeMiddlewareMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        executionOrder.push('authorize');

        next();
      });

      getPlatformMetricsControllerMock.mockImplementation((req, res) => {
        void req;

        executionOrder.push('controller');

        return res.status(200).json({
          success: true,
          data: {},
        });
      });

      const response = await request(createTestApp()).get('/metrics');

      expect(response.status).toBe(200);

      expect(executionOrder).toEqual(['authenticate', 'authorize', 'controller']);
    });

    it('delegates an authenticated ADMIN request to the metrics controller', async () => {
      const response = await request(createTestApp()).get('/metrics');

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          generatedAt: '2026-08-07T10:00:00.000Z',
        },
      });

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(authorizeMiddlewareMock).toHaveBeenCalledOnce();
      expect(getPlatformMetricsControllerMock).toHaveBeenCalledOnce();
    });

    it('prevents authorization and controller execution when authentication fails', async () => {
      authenticateMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Authentication required.');
        error.statusCode = 401;

        next(error);
      });

      const response = await request(createTestApp()).get('/metrics');

      expect(response.status).toBe(401);

      expect(response.body).toEqual({
        success: false,
        message: 'Authentication required.',
      });

      expect(authorizeMiddlewareMock).not.toHaveBeenCalled();
      expect(getPlatformMetricsControllerMock).not.toHaveBeenCalled();
    });

    it('prevents controller execution when authorization fails', async () => {
      authorizeMiddlewareMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Insufficient permissions.');
        error.statusCode = 403;

        next(error);
      });

      const response = await request(createTestApp()).get('/metrics');

      expect(response.status).toBe(403);

      expect(response.body).toEqual({
        success: false,
        message: 'Insufficient permissions.',
      });

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(authorizeMiddlewareMock).toHaveBeenCalledOnce();
      expect(getPlatformMetricsControllerMock).not.toHaveBeenCalled();
    });

    it('does not expose platform metrics through POST requests', async () => {
      const response = await request(createTestApp()).post('/metrics');

      expect(response.status).toBe(404);

      expect(authenticateMock).not.toHaveBeenCalled();
      expect(authorizeMiddlewareMock).not.toHaveBeenCalled();
      expect(getPlatformMetricsControllerMock).not.toHaveBeenCalled();
    });
  });
});
