/**
 * @file authorize.test.js
 * @description Unit tests for DispatchIQ role-based authorization middleware.
 */

import { describe, expect, it, vi } from 'vitest';

import { authorize } from './authorize.js';

describe('authorize middleware', () => {
  it('allows a user with a permitted role', () => {
    const middleware = authorize('ADMIN');

    const req = {
      user: {
        id: 'admin-123',
        email: 'admin@dispatchiq.dev',
        role: 'ADMIN',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('allows any role included in the permitted role list', () => {
    const middleware = authorize('ADMIN', 'USER');

    const req = {
      user: {
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a user whose role is not permitted', () => {
    const middleware = authorize('ADMIN');

    const req = {
      user: {
        id: 'user-123',
        email: 'amit@example.com',
        role: 'USER',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledOnce();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'AppError',
        statusCode: 403,
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have permission to perform this action.',
      }),
    );
  });

  it('rejects a request when authentication middleware was not run', () => {
    const middleware = authorize('ADMIN');

    const next = vi.fn();

    middleware({}, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'AppError',
        statusCode: 401,
        code: 'AUTHENTICATION_REQUIRED',
      }),
    );
  });

  it('rejects a request when req.user is explicitly null', () => {
    const middleware = authorize('ADMIN');

    const next = vi.fn();

    middleware(
      {
        user: null,
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
  });

  it('does not continue after authorization fails', () => {
    const middleware = authorize('ADMIN');

    const next = vi.fn();

    middleware(
      {
        user: {
          id: 'user-123',
          role: 'USER',
        },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('throws during route setup when no permitted roles are provided', () => {
    expect(() => authorize()).toThrow('authorize() requires at least one permitted role.');
  });
});
