/**
 * @file request-logger.test.js
 * @description Unit tests for DispatchIQ structured HTTP request logging.
 *
 * The centralized logger is mocked so these tests verify response-finish
 * logging, request metadata, severity selection, correlation propagation,
 * authenticated context, credential safety, duration measurement, and
 * middleware continuation independently of Pino output.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('./logger.js', () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

const { requestLogger } = await import('./request-logger.js');

/**
 * Creates a minimal Express request mock.
 *
 * @param {object} [overrides] Request-property overrides.
 * @returns {object} Request mock.
 */
function createRequest(overrides = {}) {
  const headers = {
    'user-agent': 'DispatchIQ-Test-Client/1.0',
    ...(overrides.headers ?? {}),
  };

  return {
    requestId: 'request-123',
    method: 'GET',
    originalUrl: '/api/v1/jobs?page=1',
    ip: '127.0.0.1',

    get: vi.fn((headerName) => {
      return headers[headerName.toLowerCase()];
    }),

    ...overrides,
  };
}

/**
 * Creates a response mock that captures the registered finish listener.
 *
 * @param {number} [statusCode=200] HTTP status code.
 * @returns {{
 *   statusCode: number,
 *   locals: Record<string, unknown>,
 *   once: ReturnType<typeof vi.fn>,
 *   finish: () => void
 * }} Response mock and finish trigger.
 */
function createResponse(statusCode = 200) {
  let finishListener;

  const response = {
    statusCode,

    locals: {
      requestId: 'request-123',
    },

    once: vi.fn((eventName, listener) => {
      if (eventName === 'finish') {
        finishListener = listener;
      }
    }),

    finish() {
      finishListener?.();
    },
  };

  return response;
}

describe('requestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a finish listener and continues middleware execution', () => {
    const req = createRequest();
    const res = createResponse();
    const next = vi.fn();

    requestLogger(req, res, next);

    expect(res.once).toHaveBeenCalledWith('finish', expect.any(Function));

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('logs successful requests at info level after the response finishes', () => {
    const req = createRequest();
    const res = createResponse(200);

    requestLogger(req, res, vi.fn());

    expect(loggerInfoMock).not.toHaveBeenCalled();

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledOnce();

    expect(loggerWarnMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-123',
        method: 'GET',
        path: '/api/v1/jobs?page=1',
        statusCode: 200,
        remoteAddress: '127.0.0.1',
        userAgent: 'DispatchIQ-Test-Client/1.0',
        durationMs: expect.any(Number),
      }),
      'HTTP request completed.',
    );
  });

  it('logs client-error responses at warn level', () => {
    const req = createRequest({
      method: 'POST',
      originalUrl: '/api/v1/jobs',
    });

    const res = createResponse(422);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerWarnMock).toHaveBeenCalledOnce();

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        method: 'POST',
      }),
      'HTTP request completed.',
    );

    expect(loggerInfoMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('logs server-error responses at error level', () => {
    const req = createRequest();
    const res = createResponse(500);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerErrorMock).toHaveBeenCalledOnce();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
      }),
      'HTTP request completed.',
    );

    expect(loggerInfoMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('includes the authenticated user identifier when available', () => {
    const req = createRequest({
      user: {
        id: 'user-456',
        email: 'user@dispatchiq.dev',
        role: 'USER',
      },
    });

    const res = createResponse(200);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-456',
      }),
      'HTTP request completed.',
    );
  });

  it('includes the API-key identifier for API-key-authenticated requests', () => {
    const req = createRequest({
      user: {
        id: 'user-456',
      },

      apiKey: {
        id: 'api-key-789',
        name: 'Production integration',
      },
    });

    const res = createResponse(201);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-456',
        apiKeyId: 'api-key-789',
      }),
      'HTTP request completed.',
    );
  });

  it('does not log authentication credentials or request bodies', () => {
    const req = createRequest({
      headers: {
        authorization: 'Bearer secret-jwt',
        'x-api-key': 'diq_live_secret',
        'user-agent': 'DispatchIQ-Test-Client/1.0',
      },

      body: {
        password: 'super-secret-password',
      },

      apiKey: {
        id: 'api-key-789',
        name: 'CLI',
      },
    });

    const res = createResponse(200);

    requestLogger(req, res, vi.fn());

    res.finish();

    const loggedContext = loggerInfoMock.mock.calls[0][0];

    expect(loggedContext).not.toHaveProperty('authorization');

    expect(loggedContext).not.toHaveProperty('apiKey');

    expect(loggedContext).not.toHaveProperty('body');

    expect(JSON.stringify(loggedContext)).not.toContain('secret-jwt');

    expect(JSON.stringify(loggedContext)).not.toContain('diq_live_secret');

    expect(JSON.stringify(loggedContext)).not.toContain('super-secret-password');
  });

  it('uses the response-local request identifier as a fallback', () => {
    const req = createRequest({
      requestId: undefined,
    });

    const res = createResponse(200);

    res.locals.requestId = 'response-request-456';

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'response-request-456',
      }),
      'HTTP request completed.',
    );
  });

  it('falls back to req.url when originalUrl is unavailable', () => {
    const req = createRequest({
      originalUrl: undefined,
      url: '/fallback-path',
    });

    const res = createResponse(200);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/fallback-path',
      }),
      'HTTP request completed.',
    );
  });

  it('falls back to the socket remote address when req.ip is unavailable', () => {
    const req = createRequest({
      ip: undefined,

      socket: {
        remoteAddress: '10.0.0.15',
      },
    });

    const res = createResponse(200);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteAddress: '10.0.0.15',
      }),
      'HTTP request completed.',
    );
  });

  it('records a non-negative request duration', () => {
    const req = createRequest();
    const res = createResponse(204);

    requestLogger(req, res, vi.fn());

    res.finish();

    const loggedContext = loggerInfoMock.mock.calls[0][0];

    expect(loggedContext.durationMs).toEqual(expect.any(Number));

    expect(loggedContext.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs redirects and other successful non-error responses at info level', () => {
    const req = createRequest();
    const res = createResponse(302);

    requestLogger(req, res, vi.fn());

    res.finish();

    expect(loggerInfoMock).toHaveBeenCalledOnce();
    expect(loggerWarnMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
