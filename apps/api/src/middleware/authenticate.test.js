/**
 * @file authenticate.test.js
 * @description Unit tests for JWT authentication middleware behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAccessTokenMock = vi.fn();
const findUserByIdMock = vi.fn();

vi.mock('../auth/auth.tokens.js', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

vi.mock('../auth/auth.repository.js', () => ({
  findUserById: findUserByIdMock,
}));

const { authenticate } = await import('./authenticate.js');

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates a request with a valid Bearer token', async () => {
    const req = {
      headers: {
        authorization: 'Bearer valid-access-token',
      },
    };

    const res = {};
    const next = vi.fn();

    const user = {
      id: 'user-123',
      email: 'amit@example.com',
      role: 'USER',
      createdAt: new Date('2026-08-06T08:00:00.000Z'),
      updatedAt: new Date('2026-08-06T08:00:00.000Z'),
    };

    verifyAccessTokenMock.mockReturnValue({
      sub: user.id,
      role: user.role,
      iat: 1,
      exp: 2,
    });

    findUserByIdMock.mockResolvedValue(user);

    await authenticate(req, res, next);

    expect(verifyAccessTokenMock).toHaveBeenCalledWith('valid-access-token');

    expect(findUserByIdMock).toHaveBeenCalledWith(user.id);

    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('accepts a case-insensitive Bearer scheme', async () => {
    const req = {
      headers: {
        authorization: 'bearer valid-token',
      },
    };

    const next = vi.fn();

    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-123',
      role: 'USER',
    });

    findUserByIdMock.mockResolvedValue({
      id: 'user-123',
      email: 'amit@example.com',
      role: 'USER',
    });

    await authenticate(req, {}, next);

    expect(verifyAccessTokenMock).toHaveBeenCalledWith('valid-token');

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a request without an Authorization header', async () => {
    const next = vi.fn();

    await authenticate(
      {
        headers: {},
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'AppError',
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
      }),
    );

    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const next = vi.fn();

    await authenticate(
      {
        headers: {
          authorization: 'Basic credentials',
        },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
      }),
    );

    expect(verifyAccessTokenMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid access token', async () => {
    const next = vi.fn();

    const invalidTokenError = new Error('invalid signature');

    invalidTokenError.name = 'JsonWebTokenError';

    verifyAccessTokenMock.mockImplementation(() => {
      throw invalidTokenError;
    });

    await authenticate(
      {
        headers: {
          authorization: 'Bearer invalid-token',
        },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'INVALID_ACCESS_TOKEN',
      }),
    );

    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  it('returns a specific error for an expired access token', async () => {
    const next = vi.fn();

    const expiredTokenError = new Error('jwt expired');

    expiredTokenError.name = 'TokenExpiredError';

    verifyAccessTokenMock.mockImplementation(() => {
      throw expiredTokenError;
    });

    await authenticate(
      {
        headers: {
          authorization: 'Bearer expired-token',
        },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'ACCESS_TOKEN_EXPIRED',
      }),
    );

    expect(findUserByIdMock).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const req = {
      headers: {
        authorization: 'Bearer valid-token',
      },
    };

    const next = vi.fn();

    verifyAccessTokenMock.mockReturnValue({
      sub: 'deleted-user-id',
      role: 'USER',
    });

    findUserByIdMock.mockResolvedValue(null);

    await authenticate(req, {}, next);

    expect(findUserByIdMock).toHaveBeenCalledWith('deleted-user-id');

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'AUTHENTICATED_USER_NOT_FOUND',
      }),
    );

    expect(req).not.toHaveProperty('user');
  });
});
