/**
 * @file authenticate-any.test.js
 * @description Unit tests for DispatchIQ unified authentication selection.
 *
 * JWT and API-key authentication middleware are mocked so these tests verify
 * credential selection, deterministic precedence, rejection of missing
 * credentials, and error propagation without performing token verification or
 * database access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.fn();
const authenticateApiKeyMock = vi.fn();

vi.mock('./authenticate.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('./authenticate-api-key.js', () => ({
  authenticateApiKey: authenticateApiKeyMock,
}));

const { authenticateAny } = await import('./authenticate-any.js');

/**
 * Creates a minimal Express-style request object with authentication headers.
 *
 * @param {{
 *   authorization?: string,
 *   apiKey?: string
 * }} [headers] Authentication headers.
 * @returns {object} Request mock.
 */
function createRequest({ authorization, apiKey } = {}) {
  return {
    headers: {
      ...(authorization !== undefined
        ? {
            authorization,
          }
        : {}),
    },

    get: vi.fn((headerName) => {
      if (headerName.toLowerCase() === 'x-api-key') {
        return apiKey;
      }

      return undefined;
    }),
  };
}

describe('authenticateAny', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authenticateMock.mockImplementation((req, res, next) => {
      void req;
      void res;

      next();
    });

    authenticateApiKeyMock.mockImplementation((req, res, next) => {
      void req;
      void res;

      next();
    });
  });

  it('uses JWT authentication when an Authorization header is present', () => {
    const req = createRequest({
      authorization: 'Bearer jwt-token',
    });

    const res = {};
    const next = vi.fn();

    authenticateAny(req, res, next);

    expect(authenticateMock).toHaveBeenCalledOnce();

    expect(authenticateMock).toHaveBeenCalledWith(req, res, next);

    expect(authenticateApiKeyMock).not.toHaveBeenCalled();
  });

  it('uses API-key authentication when no Authorization header is present', () => {
    const req = createRequest({
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const res = {};
    const next = vi.fn();

    authenticateAny(req, res, next);

    expect(authenticateApiKeyMock).toHaveBeenCalledOnce();

    expect(authenticateApiKeyMock).toHaveBeenCalledWith(req, res, next);

    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it('gives JWT authentication deterministic precedence when both credentials are supplied', () => {
    const req = createRequest({
      authorization: 'Bearer jwt-token',
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const res = {};
    const next = vi.fn();

    authenticateAny(req, res, next);

    expect(authenticateMock).toHaveBeenCalledOnce();

    expect(authenticateApiKeyMock).not.toHaveBeenCalled();
  });

  it('does not fall back to API-key authentication when JWT authentication fails', () => {
    const jwtError = new Error('Access token is invalid.');

    authenticateMock.mockImplementation((req, res, next) => {
      void req;
      void res;

      next(jwtError);
    });

    const req = createRequest({
      authorization: 'Bearer invalid-token',
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const next = vi.fn();

    authenticateAny(req, {}, next);

    expect(authenticateMock).toHaveBeenCalledOnce();

    expect(authenticateApiKeyMock).not.toHaveBeenCalled();

    expect(next).toHaveBeenCalledWith(jwtError);
  });

  it('propagates API-key authentication failures without attempting JWT authentication', () => {
    const apiKeyError = new Error('API key is invalid.');

    authenticateApiKeyMock.mockImplementation((req, res, next) => {
      void req;
      void res;

      next(apiKeyError);
    });

    const req = createRequest({
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const next = vi.fn();

    authenticateAny(req, {}, next);

    expect(authenticateApiKeyMock).toHaveBeenCalledOnce();

    expect(authenticateMock).not.toHaveBeenCalled();

    expect(next).toHaveBeenCalledWith(apiKeyError);
  });

  it('rejects a request when neither authentication credential is supplied', () => {
    const req = createRequest();
    const next = vi.fn();

    authenticateAny(req, {}, next);

    expect(authenticateMock).not.toHaveBeenCalled();

    expect(authenticateApiKeyMock).not.toHaveBeenCalled();

    expect(next).toHaveBeenCalledOnce();

    expect(next.mock.calls[0][0]).toMatchObject({
      message: 'Authentication is required.',
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('treats an empty Authorization header as absent', () => {
    const req = createRequest({
      authorization: '',
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const next = vi.fn();

    authenticateAny(req, {}, next);

    expect(authenticateMock).not.toHaveBeenCalled();

    expect(authenticateApiKeyMock).toHaveBeenCalledOnce();
  });

  it('treats an empty X-API-Key header as absent', () => {
    const req = createRequest({
      apiKey: '',
    });

    const next = vi.fn();

    authenticateAny(req, {}, next);

    expect(authenticateMock).not.toHaveBeenCalled();

    expect(authenticateApiKeyMock).not.toHaveBeenCalled();

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('passes the original request and response objects to JWT authentication', () => {
    const req = createRequest({
      authorization: 'Bearer jwt-token',
    });

    const res = {
      locals: {},
    };

    const next = vi.fn();

    authenticateAny(req, res, next);

    expect(authenticateMock).toHaveBeenCalledWith(req, res, next);
  });

  it('passes the original request and response objects to API-key authentication', () => {
    const req = createRequest({
      apiKey: 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
    });

    const res = {
      locals: {},
    };

    const next = vi.fn();

    authenticateAny(req, res, next);

    expect(authenticateApiKeyMock).toHaveBeenCalledWith(req, res, next);
  });
});
