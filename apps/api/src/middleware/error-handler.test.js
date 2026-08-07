/**
 * @file error-handler.test.js
 * @description Unit tests for DispatchIQ centralized Express error handling.
 *
 * These tests verify operational application errors, malformed JSON handling,
 * unexpected-error sanitization, request-ID propagation, structured failure
 * logging, optional error details, and HTTP status selection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerErrorMock = vi.fn();

vi.mock('../logger/index.js', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

const { AppError } = await import('../utils/app-error.js');
const { errorHandler } = await import('./error-handler.js');

/**
 * Creates a minimal Express response mock supporting chained status/json calls.
 *
 * @returns {{
 *   locals: Record<string, unknown>,
 *   status: ReturnType<typeof vi.fn>,
 *   json: ReturnType<typeof vi.fn>
 * }} Response mock.
 */
function createResponseMock() {
  const response = {
    locals: {},
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);

  return response;
}

/**
 * Creates an Express-style malformed JSON parser error.
 *
 * Express identifies malformed JSON using HTTP 400 and the
 * `entity.parse.failed` parser error type.
 *
 * @returns {SyntaxError & { status: number, type: string }} Parser error.
 */
function createMalformedJsonError() {
  const error = new SyntaxError('Unexpected token');

  error.status = 400;
  error.type = 'entity.parse.failed';

  return error;
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns malformed JSON errors with HTTP 400 and request ID', () => {
    const req = {
      requestId: 'request-123',
    };

    const res = createResponseMock();

    errorHandler(createMalformedJsonError(), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Request body contains malformed JSON.',
        requestId: 'request-123',
      },
    });

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('returns operational AppErrors using their configured status and code', () => {
    const error = new AppError('Resource was not found.', 404, {
      code: 'RESOURCE_NOT_FOUND',
    });

    const req = {
      requestId: 'request-456',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource was not found.',
        requestId: 'request-456',
      },
    });
  });

  it('includes operational error details when provided', () => {
    const error = new AppError('Request validation failed.', 422, {
      code: 'VALIDATION_ERROR',
      details: {
        fieldErrors: {
          email: ['Invalid email address.'],
        },
      },
    });

    const req = {
      requestId: 'request-validation',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        requestId: 'request-validation',
        details: {
          fieldErrors: {
            email: ['Invalid email address.'],
          },
        },
      },
    });
  });

  it('omits details when an operational error does not provide them', () => {
    const error = new AppError('Authentication is required.', 401, {
      code: 'AUTHENTICATION_REQUIRED',
    });

    const req = {
      requestId: 'request-auth',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    const responseBody = res.json.mock.calls[0][0];

    expect(responseBody.error).not.toHaveProperty('details');
  });

  it('uses the response-local request ID when the request value is unavailable', () => {
    const error = new AppError('Forbidden.', 403, {
      code: 'FORBIDDEN',
    });

    const req = {};

    const res = createResponseMock();

    res.locals.requestId = 'response-request-123';

    errorHandler(error, req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Forbidden.',
        requestId: 'response-request-123',
      },
    });
  });

  it('prefers req.requestId when both request-ID locations exist', () => {
    const error = new AppError('Forbidden.', 403, {
      code: 'FORBIDDEN',
    });

    const req = {
      requestId: 'request-primary',
    };

    const res = createResponseMock();

    res.locals.requestId = 'request-secondary';

    errorHandler(error, req, res, vi.fn());

    expect(res.json.mock.calls[0][0].error.requestId).toBe('request-primary');
  });

  it('sanitizes unexpected errors before returning HTTP 500', () => {
    const error = new Error('PostgreSQL connection string leaked internally.');

    const req = {
      requestId: 'request-500',
      method: 'GET',
      originalUrl: '/api/v1/jobs',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'request-500',
      },
    });

    expect(res.json.mock.calls[0][0].error.message).not.toContain('PostgreSQL');
  });

  it('logs unexpected errors with structured request context', () => {
    const error = new Error('Unexpected database failure.');

    const req = {
      requestId: 'request-log-123',
      method: 'POST',
      originalUrl: '/api/v1/jobs',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(loggerErrorMock).toHaveBeenCalledOnce();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        err: error,
        requestId: 'request-log-123',
        method: 'POST',
        path: '/api/v1/jobs',
      },
      'Unhandled request error.',
    );
  });

  it('falls back to req.url when originalUrl is unavailable during error logging', () => {
    const error = new Error('Unexpected failure.');

    const req = {
      requestId: 'request-url',
      method: 'GET',
      url: '/fallback-path',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/fallback-path',
      }),
      'Unhandled request error.',
    );
  });

  it('does not log operational AppErrors as unexpected failures', () => {
    const error = new AppError('API key is invalid.', 401, {
      code: 'INVALID_API_KEY',
    });

    const req = {
      requestId: 'request-api-key',
    };

    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('tolerates a missing request identifier', () => {
    const error = new AppError('Resource was not found.', 404, {
      code: 'RESOURCE_NOT_FOUND',
    });

    const req = {};
    const res = createResponseMock();

    errorHandler(error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource was not found.',
        requestId: undefined,
      },
    });
  });
});
