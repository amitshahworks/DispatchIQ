/**
 * @file api-key.routes.test.js
 * @description Route-level tests for DispatchIQ API-key management.
 *
 * Authentication, validation, and controller dependencies are mocked so
 * these tests verify route registration, middleware ordering, request
 * protection, validation delegation, and controller execution independently
 * of JWT verification, Zod parsing, persistence, and API-key business logic.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();

const createValidationMiddlewareMock = vi.fn();
const paramsValidationMiddlewareMock = vi.fn();

const validateMock = vi.fn((schema, target = 'body') => {
  if (target === 'params') {
    return paramsValidationMiddlewareMock;
  }

  return createValidationMiddlewareMock;
});

const createApiKeyControllerMock = vi.fn();
const listApiKeysControllerMock = vi.fn();
const revokeApiKeyControllerMock = vi.fn();

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../middleware/validate.js', () => ({
  validate: validateMock,
}));

vi.mock('./api-key.controller.js', () => ({
  createApiKeyController: createApiKeyControllerMock,
  listApiKeysController: listApiKeysControllerMock,
  revokeApiKeyController: revokeApiKeyControllerMock,
}));

vi.mock('./api-key.validation.js', () => ({
  createApiKeySchema: {
    name: 'createApiKeySchema',
  },
  apiKeyIdParamsSchema: {
    name: 'apiKeyIdParamsSchema',
  },
}));

const { apiKeyRouter } = await import('./api-key.routes.js');

/**
 * Creates an isolated Express application containing only the API-key router.
 *
 * @returns {import('express').Express} Test application.
 */
function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use('/api-keys', apiKeyRouter);

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

describe('API key routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateMock.mockImplementation((req, res, next) => {
      void res;

      req.user = {
        id: 'user-123',
        role: 'USER',
      };

      next();
    });

    createValidationMiddlewareMock.mockImplementation((req, res, next) => {
      void res;

      next();
    });

    paramsValidationMiddlewareMock.mockImplementation((req, res, next) => {
      void res;

      next();
    });

    createApiKeyControllerMock.mockImplementation((req, res) =>
      res.status(201).json({
        success: true,
        data: {
          apiKey: {
            id: 'key-123',
            userId: req.user.id,
            name: req.body.name,
          },
          key: 'diq_live_secret',
        },
      }),
    );

    listApiKeysControllerMock.mockImplementation((req, res) =>
      res.status(200).json({
        success: true,
        data: [],
      }),
    );

    revokeApiKeyControllerMock.mockImplementation((req, res) =>
      res.status(200).json({
        success: true,
        data: {
          id: req.params.apiKeyId,
          revokedAt: '2026-08-07T10:00:00.000Z',
        },
      }),
    );
  });

  describe('POST /api-keys', () => {
    it('runs authentication, body validation, and the controller in order', async () => {
      const executionOrder = [];

      authenticateMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('authenticate');

        req.user = {
          id: 'user-123',
        };

        next();
      });

      createValidationMiddlewareMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('validate');

        next();
      });

      createApiKeyControllerMock.mockImplementation((req, res) => {
        executionOrder.push('controller');

        return res.status(201).json({
          success: true,
          data: {},
        });
      });

      const response = await request(createTestApp()).post('/api-keys').send({
        name: 'CI deployment',
      });

      expect(response.status).toBe(201);

      expect(executionOrder).toEqual(['authenticate', 'validate', 'controller']);
    });

    it('delegates an authenticated validated request to the creation controller', async () => {
      const response = await request(createTestApp()).post('/api-keys').send({
        name: 'CI deployment',
      });

      expect(response.status).toBe(201);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(createValidationMiddlewareMock).toHaveBeenCalledOnce();
      expect(createApiKeyControllerMock).toHaveBeenCalledOnce();
    });

    it('prevents validation and controller execution when authentication fails', async () => {
      authenticateMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Authentication required.');
        error.statusCode = 401;

        next(error);
      });

      const response = await request(createTestApp()).post('/api-keys').send({
        name: 'CI deployment',
      });

      expect(response.status).toBe(401);

      expect(createValidationMiddlewareMock).not.toHaveBeenCalled();
      expect(createApiKeyControllerMock).not.toHaveBeenCalled();
    });

    it('prevents controller execution when body validation fails', async () => {
      createValidationMiddlewareMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Request validation failed.');
        error.statusCode = 422;

        next(error);
      });

      const response = await request(createTestApp()).post('/api-keys').send({
        name: '',
      });

      expect(response.status).toBe(422);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(createValidationMiddlewareMock).toHaveBeenCalledOnce();
      expect(createApiKeyControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /api-keys', () => {
    it('requires authentication before listing API keys', async () => {
      const executionOrder = [];

      authenticateMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('authenticate');

        req.user = {
          id: 'user-123',
        };

        next();
      });

      listApiKeysControllerMock.mockImplementation((req, res) => {
        executionOrder.push('controller');

        return res.status(200).json({
          success: true,
          data: [],
        });
      });

      const response = await request(createTestApp()).get('/api-keys');

      expect(response.status).toBe(200);

      expect(executionOrder).toEqual(['authenticate', 'controller']);
    });

    it('does not invoke listing when authentication fails', async () => {
      authenticateMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Authentication required.');
        error.statusCode = 401;

        next(error);
      });

      const response = await request(createTestApp()).get('/api-keys');

      expect(response.status).toBe(401);
      expect(listApiKeysControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /api-keys/:apiKeyId/revoke', () => {
    const apiKeyId = '550e8400-e29b-41d4-a716-446655440000';

    it('runs authentication, parameter validation, and revocation controller in order', async () => {
      const executionOrder = [];

      authenticateMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('authenticate');

        req.user = {
          id: 'user-123',
        };

        next();
      });

      paramsValidationMiddlewareMock.mockImplementation((req, res, next) => {
        void res;

        executionOrder.push('validate');

        next();
      });

      revokeApiKeyControllerMock.mockImplementation((req, res) => {
        executionOrder.push('controller');

        return res.status(200).json({
          success: true,
          data: {},
        });
      });

      const response = await request(createTestApp()).post(`/api-keys/${apiKeyId}/revoke`);

      expect(response.status).toBe(200);

      expect(executionOrder).toEqual(['authenticate', 'validate', 'controller']);
    });

    it('delegates a validated revocation request to the controller', async () => {
      const response = await request(createTestApp()).post(`/api-keys/${apiKeyId}/revoke`);

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(paramsValidationMiddlewareMock).toHaveBeenCalledOnce();
      expect(revokeApiKeyControllerMock).toHaveBeenCalledOnce();
    });

    it('prevents revocation when route-parameter validation fails', async () => {
      paramsValidationMiddlewareMock.mockImplementation((req, res, next) => {
        void req;
        void res;

        const error = new Error('Request validation failed.');
        error.statusCode = 422;

        next(error);
      });

      const response = await request(createTestApp()).post('/api-keys/not-a-uuid/revoke');

      expect(response.status).toBe(422);

      expect(revokeApiKeyControllerMock).not.toHaveBeenCalled();
    });

    it('does not expose revocation through DELETE on the collection route', async () => {
      const response = await request(createTestApp()).delete('/api-keys');

      expect(response.status).toBe(404);
      expect(revokeApiKeyControllerMock).not.toHaveBeenCalled();
    });
  });
});
