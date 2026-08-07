/**
 * @file job.routes.test.js
 * @description Integration-style tests for DispatchIQ job routing,
 * authentication policy, validation, middleware ordering, and controller
 * delegation.
 *
 * Job creation supports unified authentication so both JWT clients and
 * API-key clients can submit jobs. Read and lifecycle-management routes remain
 * JWT-only. Authentication middleware and controllers are mocked while the
 * real validation middleware and Zod schemas remain active.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateAnyMock = vi.fn();
const authenticateMock = vi.fn();

const createJobControllerMock = vi.fn();
const listJobsControllerMock = vi.fn();
const getJobControllerMock = vi.fn();
const cancelJobControllerMock = vi.fn();

vi.mock('../middleware/authenticate-any.js', () => ({
  authenticateAny: authenticateAnyMock,
}));

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('./job.controller.js', () => ({
  createJobController: createJobControllerMock,
  listJobsController: listJobsControllerMock,
  getJobController: getJobControllerMock,
  cancelJobController: cancelJobControllerMock,
}));

const { jobRouter } = await import('./job.routes.js');

/**
 * Creates an isolated Express app for route-level testing.
 *
 * @returns {import('express').Express} Test application.
 */
function createTestApp() {
  const app = express();

  app.use(express.json());
  app.use('/jobs', jobRouter);

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
 * Attaches the standard authenticated user used by route tests.
 *
 * Both JWT and API-key authentication resolve the same downstream user
 * contract, so controllers remain independent of credential type.
 *
 * @param {import('express').Request} req Express request.
 * @returns {void}
 */
function attachAuthenticatedUser(req) {
  req.user = {
    id: 'user-123',
    email: 'amit@example.com',
    role: 'USER',
  };
}

describe('job routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateAnyMock.mockImplementation((req, _res, next) => {
      attachAuthenticatedUser(req);
      next();
    });

    authenticateMock.mockImplementation((req, _res, next) => {
      attachAuthenticatedUser(req);
      next();
    });

    createJobControllerMock.mockImplementation((_req, res) =>
      res.status(201).json({
        success: true,
        data: {
          endpoint: 'create-job',
        },
      }),
    );

    listJobsControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'list-jobs',
        },
      }),
    );

    getJobControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'get-job',
        },
      }),
    );

    cancelJobControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'cancel-job',
        },
      }),
    );
  });

  describe('authentication policy', () => {
    it('uses unified authentication for job creation', async () => {
      const response = await request(createTestApp())
        .post('/jobs')
        .send({
          type: 'EMAIL',
          payload: {
            to: 'amit@example.com',
          },
        });

      expect(response.status).toBe(201);

      expect(authenticateAnyMock).toHaveBeenCalledOnce();
      expect(authenticateMock).not.toHaveBeenCalled();

      expect(createJobControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = createJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.user).toEqual({
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
      });
    });

    it('prevents job creation when unified authentication fails', async () => {
      authenticateAnyMock.mockImplementation((_req, _res, next) => {
        const error = Object.assign(new Error('Authentication is required.'), {
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
        });

        next(error);
      });

      const response = await request(createTestApp())
        .post('/jobs')
        .send({
          type: 'EMAIL',
          payload: {
            to: 'amit@example.com',
          },
        });

      expect(response.status).toBe(401);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });

      expect(createJobControllerMock).not.toHaveBeenCalled();
    });

    it('keeps job listing JWT-only', async () => {
      const response = await request(createTestApp()).get('/jobs');

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(authenticateAnyMock).not.toHaveBeenCalled();
      expect(listJobsControllerMock).toHaveBeenCalledOnce();
    });

    it('keeps job detail retrieval JWT-only', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(createTestApp()).get(`/jobs/${jobId}`);

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(authenticateAnyMock).not.toHaveBeenCalled();
      expect(getJobControllerMock).toHaveBeenCalledOnce();
    });

    it('keeps job cancellation JWT-only', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(createTestApp()).post(`/jobs/${jobId}/cancel`);

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();
      expect(authenticateAnyMock).not.toHaveBeenCalled();
      expect(cancelJobControllerMock).toHaveBeenCalledOnce();
    });

    it('prevents JWT-only routes from running when JWT authentication fails', async () => {
      authenticateMock.mockImplementation((_req, _res, next) => {
        const error = Object.assign(new Error('Authentication is required.'), {
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
        });

        next(error);
      });

      const response = await request(createTestApp()).get('/jobs');

      expect(response.status).toBe(401);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });

      expect(listJobsControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /jobs', () => {
    it('runs unified authentication before validation and controller execution', async () => {
      const executionOrder = [];

      authenticateAnyMock.mockImplementation((req, _res, next) => {
        executionOrder.push('authenticate');

        attachAuthenticatedUser(req);

        next();
      });

      createJobControllerMock.mockImplementation((_req, res) => {
        executionOrder.push('controller');

        return res.status(201).json({
          success: true,
          data: {},
        });
      });

      const response = await request(createTestApp())
        .post('/jobs')
        .send({
          type: 'EMAIL',
          payload: {
            to: 'amit@example.com',
          },
        });

      expect(response.status).toBe(201);

      expect(executionOrder).toEqual(['authenticate', 'controller']);
    });

    it('validates, normalizes, and delegates job creation', async () => {
      const response = await request(createTestApp())
        .post('/jobs')
        .send({
          type: 'EMAIL',
          payload: {
            to: 'amit@example.com',
          },
          maxAttempts: '5',
        });

      expect(response.status).toBe(201);
      expect(createJobControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = createJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.body).toEqual({
        type: 'EMAIL',
        priority: 'MEDIUM',
        payload: {
          to: 'amit@example.com',
        },
        maxAttempts: 5,
      });
    });

    it('rejects invalid job input before the controller runs', async () => {
      const response = await request(createTestApp()).post('/jobs').send({
        type: 'UNSUPPORTED',
        payload: {},
      });

      expect(response.status).toBe(422);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
        },
      });

      expect(authenticateAnyMock).toHaveBeenCalledOnce();
      expect(createJobControllerMock).not.toHaveBeenCalled();
    });

    it('strips server-controlled fields from job creation input', async () => {
      const response = await request(createTestApp())
        .post('/jobs')
        .send({
          type: 'WEBHOOK',
          payload: {
            url: 'https://example.com/webhook',
          },
          status: 'COMPLETED',
          attemptCount: 99,
          lockedByWorkerId: 'worker-123',
        });

      expect(response.status).toBe(201);

      const controllerRequest = createJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.body).toEqual({
        type: 'WEBHOOK',
        priority: 'MEDIUM',
        payload: {
          url: 'https://example.com/webhook',
        },
        maxAttempts: 3,
      });
    });

    it('preserves the authenticated user for API-key-style job submission', async () => {
      authenticateAnyMock.mockImplementation((req, _res, next) => {
        req.user = {
          id: 'api-user-456',
          email: 'service@dispatchiq.dev',
          role: 'USER',
        };

        req.apiKey = {
          id: 'key-123',
          name: 'Production integration',
        };

        next();
      });

      const response = await request(createTestApp())
        .post('/jobs')
        .set('X-API-Key', 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789')
        .send({
          type: 'WEBHOOK',
          payload: {
            url: 'https://example.com/webhook',
          },
        });

      expect(response.status).toBe(201);

      const controllerRequest = createJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.user).toEqual({
        id: 'api-user-456',
        email: 'service@dispatchiq.dev',
        role: 'USER',
      });

      expect(controllerRequest.apiKey).toEqual({
        id: 'key-123',
        name: 'Production integration',
      });
    });
  });

  describe('GET /jobs', () => {
    it('validates and normalizes listing query parameters', async () => {
      const response = await request(createTestApp()).get('/jobs').query({
        page: '2',
        limit: '25',
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(response.status).toBe(200);
      expect(listJobsControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = listJobsControllerMock.mock.calls[0][0];

      expect(controllerRequest.query).toEqual({
        page: 2,
        limit: 25,
        status: 'FAILED',
        type: 'WEBHOOK',
      });
    });

    it('applies pagination defaults when query parameters are omitted', async () => {
      await request(createTestApp()).get('/jobs');

      const controllerRequest = listJobsControllerMock.mock.calls[0][0];

      expect(controllerRequest.query).toEqual({
        page: 1,
        limit: 20,
      });
    });

    it('rejects invalid listing filters', async () => {
      const response = await request(createTestApp()).get('/jobs').query({
        status: 'RUNNING',
        limit: '101',
      });

      expect(response.status).toBe(422);
      expect(listJobsControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /jobs/:jobId', () => {
    it('validates the job identifier before delegating', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(createTestApp()).get(`/jobs/${jobId}`);

      expect(response.status).toBe(200);
      expect(getJobControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = getJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.params).toEqual({
        jobId,
      });
    });

    it('rejects an invalid job identifier', async () => {
      const response = await request(createTestApp()).get('/jobs/not-a-uuid');

      expect(response.status).toBe(422);
      expect(getJobControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /jobs/:jobId/cancel', () => {
    it('validates the job identifier before cancellation', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';

      const response = await request(createTestApp()).post(`/jobs/${jobId}/cancel`);

      expect(response.status).toBe(200);
      expect(cancelJobControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = cancelJobControllerMock.mock.calls[0][0];

      expect(controllerRequest.params).toEqual({
        jobId,
      });
    });

    it('rejects cancellation with an invalid job identifier', async () => {
      const response = await request(createTestApp()).post('/jobs/invalid-id/cancel');

      expect(response.status).toBe(422);
      expect(cancelJobControllerMock).not.toHaveBeenCalled();
    });
  });
});
