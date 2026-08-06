/**
 * @file validate.test.js
 * @description Unit tests for the Zod validation middleware.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { validate } from './validate.js';

describe('validate middleware', () => {
  const schema = z.object({
    email: z.email(),
    age: z.coerce.number().int().positive(),
  });

  it('accepts valid request data', () => {
    const middleware = validate(schema);

    const req = {
      body: {
        email: 'amit@example.com',
        age: '21',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(req.body).toEqual({
      email: 'amit@example.com',
      age: 21,
    });

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects invalid request data', () => {
    const middleware = validate(schema);

    const req = {
      body: {
        email: 'invalid-email',
        age: -5,
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledOnce();

    const error = next.mock.calls[0][0];

    expect(error).toMatchObject({
      name: 'AppError',
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });

    expect(error.details).toBeDefined();
  });

  it('rejects missing required fields', () => {
    const middleware = validate(schema);

    const req = {
      body: {},
    };

    const next = vi.fn();

    middleware(req, {}, next);

    const error = next.mock.calls[0][0];

    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('applies zod transforms before controllers execute', () => {
    const middleware = validate(
      z.object({
        email: z.email().transform((value) => value.toLowerCase()),
      }),
    );

    const req = {
      body: {
        email: 'AMIT@EXAMPLE.COM',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(req.body.email).toBe('amit@example.com');
  });

  it('supports schemas with default values', () => {
    const middleware = validate(
      z.object({
        role: z.string().default('USER'),
      }),
    );

    const req = {
      body: {},
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(req.body).toEqual({
      role: 'USER',
    });
  });
});
