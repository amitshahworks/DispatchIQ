/**
 * @file dashboard.routes.test.js
 * @description Route-level tests for the DispatchIQ Dashboard API.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const authorizeMiddlewareMock = vi.fn();
const authorizeMock = vi.fn();

const overviewControllerMock = vi.fn();
const systemHealthControllerMock = vi.fn();

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../middleware/authorize.js', () => ({
  authorize: authorizeMock,
}));

vi.mock('./dashboard.controller.js', () => ({
  getDashboardOverviewController: overviewControllerMock,
  getSystemHealthController: systemHealthControllerMock,
}));

authorizeMock.mockReturnValue(authorizeMiddlewareMock);

const { dashboardRouter } = await import('./dashboard.routes.js');

function createTestApp() {
  const app = express();

  app.use(express.json());

  app.use('/dashboard', dashboardRouter);

  app.use((error, _req, res, _next) =>
    res.status(error.statusCode ?? 500).json({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_SERVER_ERROR',
        message: error.message,
      },
    }),
  );

  return app;
}

describe('dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateMock.mockImplementation((req, _res, next) => {
      req.user = {
        id: 'admin-1',
        role: 'ADMIN',
      };

      next();
    });

    authorizeMiddlewareMock.mockImplementation((_req, _res, next) => next());

    overviewControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'overview',
        },
      }),
    );

    systemHealthControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,
        data: {
          endpoint: 'system-health',
        },
      }),
    );
  });

  it('returns dashboard overview', async () => {
    const response = await request(createTestApp()).get('/dashboard/overview');

    expect(response.status).toBe(200);

    expect(authenticateMock).toHaveBeenCalledOnce();

    expect(authorizeMiddlewareMock).toHaveBeenCalledOnce();

    expect(overviewControllerMock).toHaveBeenCalledOnce();
  });

  it('returns system health', async () => {
    const response = await request(createTestApp()).get('/dashboard/system-health');

    expect(response.status).toBe(200);

    expect(systemHealthControllerMock).toHaveBeenCalledOnce();
  });

  it('blocks unauthenticated requests', async () => {
    authenticateMock.mockImplementation((_req, _res, next) => {
      next(
        Object.assign(new Error('Authentication required'), {
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
        }),
      );
    });

    const response = await request(createTestApp()).get('/dashboard/overview');

    expect(response.status).toBe(401);

    expect(overviewControllerMock).not.toHaveBeenCalled();
  });

  it('blocks unauthorized users', async () => {
    authorizeMiddlewareMock.mockImplementation((_req, _res, next) => {
      next(
        Object.assign(new Error('Forbidden'), {
          statusCode: 403,
          code: 'INSUFFICIENT_PERMISSIONS',
        }),
      );
    });

    const response = await request(createTestApp()).get('/dashboard/overview');

    expect(response.status).toBe(403);

    expect(overviewControllerMock).not.toHaveBeenCalled();
  });
});
