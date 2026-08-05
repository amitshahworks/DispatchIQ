/**
 * Tests the operational application error used by the API error pipeline.
 */

import { describe, expect, it } from 'vitest';

import { AppError } from './app-error.js';

describe('AppError', () => {
  it('creates an operational error with default options', () => {
    const error = new AppError('Resource not found.', 404);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.message).toBe('Resource not found.');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('APP_ERROR');
    expect(error.isOperational).toBe(true);
    expect(error.details).toBeUndefined();
  });

  it('supports a custom code and safe details', () => {
    const details = {
      field: 'email',
    };

    const error = new AppError('Invalid input.', 400, {
      code: 'VALIDATION_ERROR',
      details,
    });

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual(details);
  });

  it('allows an error to be marked as non-operational', () => {
    const error = new AppError('Unexpected failure.', 500, {
      isOperational: false,
    });

    expect(error.isOperational).toBe(false);
  });
});
