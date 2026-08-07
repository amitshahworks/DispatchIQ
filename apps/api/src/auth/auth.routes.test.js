/**
 * @file auth.routes.test.js
 * @description Integration-style route tests for DispatchIQ authentication
 * routing, rate limiting, validation, middleware order, and controller
 * delegation.
 *
 * Authentication controllers and rate-limit middleware are mocked so this
 * suite verifies route composition independently of authentication business
 * logic and express-rate-limit's internal quota implementation.
 *
 * Real quota behavior is covered separately by security/rate-limit.test.js.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerControllerMock = vi.fn();
const loginControllerMock = vi.fn();
const refreshControllerMock = vi.fn();
const logoutControllerMock = vi.fn();
const meControllerMock = vi.fn();
const authenticateMock = vi.fn();

const registrationRateLimiterMock = vi.fn();
const loginRateLimiterMock = vi.fn();
const refreshTokenRateLimiterMock = vi.fn();

vi.mock('./auth.controller.js', () => ({
  registerController: registerControllerMock,

  loginController: loginControllerMock,

  refreshController: refreshControllerMock,

  logoutController: logoutControllerMock,

  meController: meControllerMock,
}));

vi.mock('../middleware/authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../security/rate-limit.js', () => ({
  registrationRateLimiter: registrationRateLimiterMock,

  loginRateLimiter: loginRateLimiterMock,

  refreshTokenRateLimiter: refreshTokenRateLimiterMock,
}));

/*
 * Route modules capture middleware references during import. The limiter mocks
 * therefore require pass-through implementations before auth.routes.js loads.
 */
registrationRateLimiterMock.mockImplementation((_req, _res, next) => next());

loginRateLimiterMock.mockImplementation((_req, _res, next) => next());

refreshTokenRateLimiterMock.mockImplementation((_req, _res, next) => next());

const { authRouter } = await import('./auth.routes.js');

/**
 * Creates an isolated Express application for authentication route tests.
 *
 * @returns {import('express').Express} Test application.
 */
function createTestApp() {
  const app = express();

  app.use(express.json());

  app.use('/auth', authRouter);

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

describe('authentication routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    registrationRateLimiterMock.mockImplementation((_req, _res, next) => next());

    loginRateLimiterMock.mockImplementation((_req, _res, next) => next());

    refreshTokenRateLimiterMock.mockImplementation((_req, _res, next) => next());

    registerControllerMock.mockImplementation((_req, res) =>
      res.status(201).json({
        success: true,

        data: {
          endpoint: 'register',
        },
      }),
    );

    loginControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,

        data: {
          endpoint: 'login',
        },
      }),
    );

    refreshControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,

        data: {
          endpoint: 'refresh',
        },
      }),
    );

    logoutControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,

        data: {
          endpoint: 'logout',
        },
      }),
    );

    meControllerMock.mockImplementation((_req, res) =>
      res.status(200).json({
        success: true,

        data: {
          endpoint: 'me',
        },
      }),
    );

    authenticateMock.mockImplementation((req, _res, next) => {
      req.user = {
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
      };

      next();
    });
  });

  describe('POST /auth/register', () => {
    it('runs registration rate limiting before validation and controller execution', async () => {
      const response = await request(createTestApp()).post('/auth/register').send({
        email: 'amit@example.com',
        password: 'SecurePassword123',
      });

      expect(response.status).toBe(201);

      expect(registrationRateLimiterMock).toHaveBeenCalledOnce();

      expect(registerControllerMock).toHaveBeenCalledOnce();
    });

    it('validates input and delegates to the register controller', async () => {
      const response = await request(createTestApp()).post('/auth/register').send({
        email: '  Amit@Example.COM  ',

        password: 'SecurePassword123',
      });

      expect(response.status).toBe(201);

      expect(registerControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = registerControllerMock.mock.calls[0][0];

      expect(controllerRequest.body).toEqual({
        email: 'amit@example.com',

        password: 'SecurePassword123',
      });
    });

    it('rejects invalid registration input before the controller runs', async () => {
      const response = await request(createTestApp()).post('/auth/register').send({
        email: 'invalid-email',
        password: 'weak',
      });

      expect(response.status).toBe(422);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'VALIDATION_ERROR',

          message: 'Request validation failed.',
        },
      });

      expect(registerControllerMock).not.toHaveBeenCalled();
    });

    it('strips a client-supplied role before registration', async () => {
      await request(createTestApp()).post('/auth/register').send({
        email: 'amit@example.com',

        password: 'SecurePassword123',

        role: 'ADMIN',
      });

      const controllerRequest = registerControllerMock.mock.calls[0][0];

      expect(controllerRequest.body).toEqual({
        email: 'amit@example.com',

        password: 'SecurePassword123',
      });
    });

    it('stops registration when the registration rate limit is exceeded', async () => {
      registrationRateLimiterMock.mockImplementation((_req, res, _next) =>
        res.status(429).json({
          success: false,

          error: {
            code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',

            message: 'Too many registration attempts. Please try again later.',
          },
        }),
      );

      const response = await request(createTestApp()).post('/auth/register').send({
        email: 'amit@example.com',

        password: 'SecurePassword123',
      });

      expect(response.status).toBe(429);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
        },
      });

      expect(registerControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/login', () => {
    it('runs login rate limiting before validation and controller execution', async () => {
      const response = await request(createTestApp()).post('/auth/login').send({
        email: 'amit@example.com',

        password: 'existing-password',
      });

      expect(response.status).toBe(200);

      expect(loginRateLimiterMock).toHaveBeenCalledOnce();

      expect(loginControllerMock).toHaveBeenCalledOnce();
    });

    it('validates input and delegates to the login controller', async () => {
      const response = await request(createTestApp()).post('/auth/login').send({
        email: '  Amit@Example.COM ',

        password: 'existing-password',
      });

      expect(response.status).toBe(200);

      expect(loginControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = loginControllerMock.mock.calls[0][0];

      expect(controllerRequest.body).toEqual({
        email: 'amit@example.com',

        password: 'existing-password',
      });
    });

    it('rejects an empty login password', async () => {
      const response = await request(createTestApp()).post('/auth/login').send({
        email: 'amit@example.com',
        password: '',
      });

      expect(response.status).toBe(422);

      expect(loginControllerMock).not.toHaveBeenCalled();
    });

    it('stops login when the login rate limit is exceeded', async () => {
      loginRateLimiterMock.mockImplementation((_req, res, _next) =>
        res.status(429).json({
          success: false,

          error: {
            code: 'LOGIN_RATE_LIMIT_EXCEEDED',

            message: 'Too many login attempts. Please try again later.',
          },
        }),
      );

      const response = await request(createTestApp()).post('/auth/login').send({
        email: 'amit@example.com',

        password: 'existing-password',
      });

      expect(response.status).toBe(429);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'LOGIN_RATE_LIMIT_EXCEEDED',
        },
      });

      expect(loginControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    it('runs refresh-token rate limiting before validation and controller execution', async () => {
      const response = await request(createTestApp()).post('/auth/refresh').send({
        refreshToken: 'current-refresh-token',
      });

      expect(response.status).toBe(200);

      expect(refreshTokenRateLimiterMock).toHaveBeenCalledOnce();

      expect(refreshControllerMock).toHaveBeenCalledOnce();
    });

    it('validates input and delegates to the refresh controller', async () => {
      const response = await request(createTestApp()).post('/auth/refresh').send({
        refreshToken: 'current-refresh-token',
      });

      expect(response.status).toBe(200);

      expect(refreshControllerMock).toHaveBeenCalledOnce();
    });

    it('rejects a missing refresh token', async () => {
      const response = await request(createTestApp()).post('/auth/refresh').send({});

      expect(response.status).toBe(422);

      expect(refreshControllerMock).not.toHaveBeenCalled();
    });

    it('stops refresh requests when the refresh rate limit is exceeded', async () => {
      refreshTokenRateLimiterMock.mockImplementation((_req, res, _next) =>
        res.status(429).json({
          success: false,

          error: {
            code: 'REFRESH_RATE_LIMIT_EXCEEDED',

            message: 'Too many token refresh requests. Please try again later.',
          },
        }),
      );

      const response = await request(createTestApp()).post('/auth/refresh').send({
        refreshToken: 'current-refresh-token',
      });

      expect(response.status).toBe(429);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'REFRESH_RATE_LIMIT_EXCEEDED',
        },
      });

      expect(refreshControllerMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout', () => {
    it('validates input and delegates to the logout controller', async () => {
      const response = await request(createTestApp()).post('/auth/logout').send({
        refreshToken: 'refresh-token',
      });

      expect(response.status).toBe(200);

      expect(logoutControllerMock).toHaveBeenCalledOnce();
    });

    it('rejects an empty refresh token', async () => {
      const response = await request(createTestApp()).post('/auth/logout').send({
        refreshToken: '   ',
      });

      expect(response.status).toBe(422);

      expect(logoutControllerMock).not.toHaveBeenCalled();
    });

    it('does not apply an authentication-specific rate limiter to logout', async () => {
      await request(createTestApp()).post('/auth/logout').send({
        refreshToken: 'refresh-token',
      });

      expect(registrationRateLimiterMock).not.toHaveBeenCalled();

      expect(loginRateLimiterMock).not.toHaveBeenCalled();

      expect(refreshTokenRateLimiterMock).not.toHaveBeenCalled();
    });
  });

  describe('GET /auth/me', () => {
    it('runs authentication before the current-user controller', async () => {
      const response = await request(createTestApp()).get('/auth/me');

      expect(response.status).toBe(200);

      expect(authenticateMock).toHaveBeenCalledOnce();

      expect(meControllerMock).toHaveBeenCalledOnce();

      const controllerRequest = meControllerMock.mock.calls[0][0];

      expect(controllerRequest.user).toEqual({
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
      });
    });

    it('does not run the controller when authentication fails', async () => {
      authenticateMock.mockImplementation((_req, _res, next) => {
        const error = new Error('Authentication is required.');

        error.statusCode = 401;

        error.code = 'AUTHENTICATION_REQUIRED';

        next(error);
      });

      const response = await request(createTestApp()).get('/auth/me');

      expect(response.status).toBe(401);

      expect(response.body).toMatchObject({
        success: false,

        error: {
          code: 'AUTHENTICATION_REQUIRED',
        },
      });

      expect(meControllerMock).not.toHaveBeenCalled();
    });

    it('does not apply authentication endpoint rate limiters to the current-user endpoint', async () => {
      await request(createTestApp()).get('/auth/me');

      expect(registrationRateLimiterMock).not.toHaveBeenCalled();

      expect(loginRateLimiterMock).not.toHaveBeenCalled();

      expect(refreshTokenRateLimiterMock).not.toHaveBeenCalled();
    });
  });
});
