/**
 * @file worker.routes.test.js
 * @description Integration-style tests for DispatchIQ Worker Management API
 * routing, JWT authentication, ADMIN authorization, validation, route
 * precedence, and controller delegation.
 *
 * Authentication, authorization, and controllers are mocked while the real
 * validation middleware and Zod schemas remain active.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const authorizeMiddlewareMock = vi.fn();
const authorizeMock = vi.fn();

const listWorkersControllerMock = vi.fn();
const getWorkerControllerMock = vi.fn();
const getWorkerHealthControllerMock = vi.fn();

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../middleware/authorize.js', () => ({
  authorize: authorizeMock,
}));

vi.mock('./worker.controller.js', () => ({
  listWorkersController: listWorkersControllerMock,
  getWorkerController: getWorkerControllerMock,
  getWorkerHealthController: getWorkerHealthControllerMock,
}));

/*
 * `authorize('ADMIN')` executes while the route module is imported, so its
 * middleware implementation must exist before importing worker.routes.js.
 */
authorizeMock.mockReturnValue(authorizeMiddlewareMock);

const { workerRouter } = await import('./worker.routes.js');

/**
 * Creates an isolated Express application for route-level testing.
 *
 * @returns {import('express').Express} Test application.
 */
function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use('/workers', workerRouter);

  app.use((error, _req, res, _next) => {
    return res.status(error.statusCode ?? 500).json({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_SERVER_ERROR',
        message: error.message,
        details: error.details,
      },
    });
  });

  return app;
}

/**
 * Attaches an authenticated ADMIN user to the request.
 *
 * @param {import('express').Request} req Express request.
 * @returns {void}
 */
function attachAdminUser(req) {
  req.user = {
    id: 'admin-123',
    email: 'admin@dispatchiq.dev',
    role: 'ADMIN',
  };
}

describe('worker routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateMock.mockImplementation((req, _res, next) => {
      attachAdminUser(req);
      next();
    });

    authorizeMiddlewareMock.mockImplementation((_req, _res, next) => {
      next();
    });

    listWorkersControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'list-workers',
        },
      }),
    );

    getWorkerControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'get-worker',
        },
      }),
    );

    getWorkerHealthControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'worker-health',
        },
      }),
    );
  });

  describe('security policy', () => {

    it('runs JWT authentication before worker listing', async () => {
      const response = await request(createTestApp()).get('/workers');

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();

      expect(authorizeMiddlewareMock).toHaveBeenCalledOnce();

      expect(listWorkersControllerMock).toHaveBeenCalledOnce();
    });

    it('prevents controllers from running when authentication fails', async () => {
      authenticateMock.mockImplementation((_req, _res, next) => {
        next(
          Object.assign(new Error('Authentication is required.'), {
            statusCode: 401,
            code: 'AUTHENTICATION_REQUIRED',
          }),
        );
      });

      const response = await request(createTestApp()).get('/workers');

      expect(response.status).toBe(401);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });

      expect(authorizeMiddlewareMock).not.toHaveBeenCalled();

      expect(listWorkersControllerMock).not.toHaveBeenCalled();
    });

    it('prevents controllers from running when authorization fails', async () => {
      authorizeMiddlewareMock.mockImplementation((_req, _res, next) => {
        next(
          Object.assign(new Error('You do not have permission to perform this action.'), {
            statusCode: 403,
            code: 'INSUFFICIENT_PERMISSIONS',
          }),
        );
      });

      const response = await request(createTestApp()).get('/workers');

      expect(response.status).toBe(403);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
        },
      });

      expect(listWorkersControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /workers', () => {
    it('validates and normalizes worker-list query parameters', async () => {
      const response = await request(createTestApp()).get('/workers').query({
        page: '2',
        limit: '25',
        status: 'BUSY',
      });

      expect(response.status).toBe(200);

      expect(listWorkersControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = listWorkersControllerMock.mock.calls[0][0];

      expect(controllerRequest.query).toEqual({
        page: 2,
        limit: 25,
        status: 'BUSY',
      });
    });

    it('applies worker-list pagination defaults', async () => {
      const response = await request(createTestApp()).get('/workers');

      expect(response.status).toBe(200);

      const controllerRequest = listWorkersControllerMock.mock.calls[0][0];

      expect(controllerRequest.query).toEqual({
        page: 1,
        limit: 20,
      });
    });

    it('rejects invalid lifecycle filters before controller execution', async () => {
      const response = await request(createTestApp()).get('/workers').query({
        status: 'CRASHED',
      });

      expect(response.status).toBe(422);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
        },
      });

      expect(listWorkersControllerMock).not.toHaveBeenCalled();
    });

    it('rejects pagination limits greater than the supported maximum', async () => {
      const response = await request(createTestApp()).get('/workers').query({
        limit: '101',
      });

      expect(response.status).toBe(422);

      expect(listWorkersControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /workers/health', () => {
    it('delegates cluster health requests to the health controller', async () => {
      const response = await request(createTestApp()).get('/workers/health');

      expect(response.status).toBe(200);

      expect(getWorkerHealthControllerMock).toHaveBeenCalledOnce();

      expect(getWorkerControllerMock).not.toHaveBeenCalled();
    });

    it('does not interpret the health route as a worker identifier', async () => {
      await request(createTestApp()).get('/workers/health');

      expect(getWorkerControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /workers/:workerId', () => {
    it('validates the worker identifier before delegating', async () => {
      const workerId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(createTestApp()).get(`/workers/${workerId}`);

      expect(response.status).toBe(200);

      expect(getWorkerControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = getWorkerControllerMock.mock.calls[0][0];

      expect(controllerRequest.params).toEqual({
        workerId,
      });
    });

    it('rejects malformed worker identifiers before controller execution', async () => {
      const response = await request(createTestApp()).get('/workers/not-a-uuid');

      expect(response.status).toBe(422);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });

      expect(getWorkerControllerMock).not.toHaveBeenCalled();
    });
  });
});
