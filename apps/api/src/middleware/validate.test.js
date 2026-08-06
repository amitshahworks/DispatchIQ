/**
 * @file validate.test.js
 * @description Unit tests for body, query, and route-parameter validation.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { validate } from './validate.js';

describe('validate middleware', () => {
  const bodySchema = z.object({
    email: z.email(),
    age: z.coerce.number().int().positive(),
  });

  it('validates and normalizes request bodies by default', () => {
    const middleware = validate(bodySchema);

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

  it('validates and normalizes query parameters', () => {
    const middleware = validate(
      z.object({
        page: z.coerce.number().int().positive(),
        status: z.enum(['QUEUED', 'FAILED']).optional(),
      }),
      'query',
    );

    const req = {
      query: {
        page: '2',
        status: 'FAILED',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(req.query).toEqual({
      page: 2,
      status: 'FAILED',
    });

    expect(next).toHaveBeenCalledWith();
  });

  it('validates route parameters', () => {
    const middleware = validate(
      z.object({
        jobId: z.uuid(),
      }),
      'params',
    );

    const req = {
      params: {
        jobId: '123e4567-e89b-12d3-a456-426614174000',
      },
    };

    const next = vi.fn();

    middleware(req, {}, next);

    expect(req.params).toEqual({
      jobId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(next).toHaveBeenCalledWith();
  });

  it('forwards a safe validation error for invalid request data', () => {
    const middleware = validate(bodySchema);

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
      message: 'Request validation failed.',
    });

    expect(error.details).toMatchObject({
      target: 'body',
    });

    expect(error.details.fieldErrors).toBeDefined();
  });

  it('reports the failing request target in validation details', () => {
    const middleware = validate(
      z.object({
        page: z.coerce.number().int().positive(),
      }),
      'query',
    );

    const next = vi.fn();

    middleware(
      {
        query: {
          page: '0',
        },
      },
      {},
      next,
    );

    const error = next.mock.calls[0][0];

    expect(error.details.target).toBe('query');
  });

  it('applies Zod transforms before controllers execute', () => {
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

  it('throws during route setup for an unsupported target', () => {
    expect(() => validate(bodySchema, 'headers')).toThrow(
      'Unsupported validation target "headers". Expected body, query, or params.',
    );
  });
});

it('supports Express 5 getter-based query properties', () => {
  const middleware = validate(
    z.object({
      page: z.coerce.number().int().positive().default(1),
    }),
    'query',
  );

  const req = {};

  Object.defineProperty(req, 'query', {
    configurable: true,
    get() {
      return {
        page: '2',
      };
    },
  });

  const next = vi.fn();

  middleware(req, {}, next);

  expect(req.query).toEqual({
    page: 2,
  });

  expect(next).toHaveBeenCalledWith();
});
