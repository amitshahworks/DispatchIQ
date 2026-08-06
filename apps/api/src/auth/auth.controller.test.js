/**
 * @file auth.controller.test.js
 * @description Unit tests for DispatchIQ authentication HTTP controllers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerMock = vi.fn();
const loginMock = vi.fn();
const refreshMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('./auth.service.js', () => ({
  register: registerMock,
  login: loginMock,
  refresh: refreshMock,
  logout: logoutMock,
}));

const { loginController, logoutController, meController, refreshController, registerController } =
  await import('./auth.controller.js');

/**
 * Creates a minimal Express response mock supporting chained status/json calls.
 *
 * @returns {{
 *   status: ReturnType<typeof vi.fn>,
 *   json: ReturnType<typeof vi.fn>
 * }}
 */
function createResponseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);

  return response;
}

describe('authentication controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerController', () => {
    it('registers a user and returns HTTP 201', async () => {
      const requestBody = {
        email: 'amit@example.com',
        password: 'SecurePassword123',
      };

      const serviceResult = {
        user: {
          id: 'user-123',
          email: requestBody.email,
          role: 'USER',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      registerMock.mockResolvedValue(serviceResult);

      const req = {
        body: requestBody,
      };

      const res = createResponseMock();
      const next = vi.fn();

      await registerController(req, res, next);

      expect(registerMock).toHaveBeenCalledWith(requestBody);

      expect(res.status).toHaveBeenCalledWith(201);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: serviceResult,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards registration failures to error middleware', async () => {
      const error = new Error('Registration failed.');

      registerMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await registerController(
        {
          body: {
            email: 'amit@example.com',
            password: 'SecurePassword123',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('loginController', () => {
    it('authenticates a user and returns HTTP 200', async () => {
      const requestBody = {
        email: 'amit@example.com',
        password: 'SecurePassword123',
      };

      const serviceResult = {
        user: {
          id: 'user-123',
          email: requestBody.email,
          role: 'USER',
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };

      loginMock.mockResolvedValue(serviceResult);

      const res = createResponseMock();
      const next = vi.fn();

      await loginController(
        {
          body: requestBody,
        },
        res,
        next,
      );

      expect(loginMock).toHaveBeenCalledWith(requestBody);

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: serviceResult,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards login failures to error middleware', async () => {
      const error = new Error('Login failed.');

      loginMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await loginController(
        {
          body: {
            email: 'amit@example.com',
            password: 'incorrect-password',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('refreshController', () => {
    it('rotates a refresh token and returns HTTP 200', async () => {
      const requestBody = {
        refreshToken: 'current-refresh-token',
      };

      const serviceResult = {
        accessToken: 'replacement-access-token',
        refreshToken: 'replacement-refresh-token',
      };

      refreshMock.mockResolvedValue(serviceResult);

      const res = createResponseMock();
      const next = vi.fn();

      await refreshController(
        {
          body: requestBody,
        },
        res,
        next,
      );

      expect(refreshMock).toHaveBeenCalledWith(requestBody);

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: serviceResult,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards refresh failures to error middleware', async () => {
      const error = new Error('Refresh failed.');

      refreshMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await refreshController(
        {
          body: {
            refreshToken: 'invalid-refresh-token',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('logoutController', () => {
    it('revokes the refresh token and returns HTTP 200', async () => {
      const requestBody = {
        refreshToken: 'refresh-token',
      };

      logoutMock.mockResolvedValue(undefined);

      const res = createResponseMock();
      const next = vi.fn();

      await logoutController(
        {
          body: requestBody,
        },
        res,
        next,
      );

      expect(logoutMock).toHaveBeenCalledWith(requestBody);

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          message: 'Logged out successfully.',
        },
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards logout failures to error middleware', async () => {
      const error = new Error('Logout failed.');

      logoutMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await logoutController(
        {
          body: {
            refreshToken: 'refresh-token',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('meController', () => {
    it('returns the authenticated user', async () => {
      const user = {
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
        createdAt: new Date('2026-08-06T08:00:00.000Z'),
        updatedAt: new Date('2026-08-06T08:00:00.000Z'),
      };

      const res = createResponseMock();
      const next = vi.fn();

      await meController(
        {
          user,
        },
        res,
        next,
      );

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          user,
        },
      });

      expect(next).not.toHaveBeenCalled();
    });
  });
});
