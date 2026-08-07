/**
 * @file request-id.test.js
 * @description Unit tests for DispatchIQ request-correlation middleware.
 *
 * These tests verify generated identifiers, trusted incoming identifiers,
 * normalization behavior, length protection, request/response propagation,
 * and middleware continuation without requiring a running Express server.
 */

import { describe, expect, it, vi } from 'vitest';

import { requestId } from './request-id.js';

/**
 * Creates a minimal Express request mock.
 *
 * @param {unknown} incomingRequestId Optional X-Request-Id header value.
 * @returns {object} Request mock.
 */
function createRequest(incomingRequestId) {
  return {
    get: vi.fn((headerName) => {
      if (headerName.toLowerCase() === 'x-request-id') {
        return incomingRequestId;
      }

      return undefined;
    }),
  };
}

/**
 * Creates a minimal Express response mock.
 *
 * @returns {{
 *   locals: Record<string, unknown>,
 *   setHeader: ReturnType<typeof vi.fn>
 * }} Response mock.
 */
function createResponse() {
  return {
    locals: {},
    setHeader: vi.fn(),
  };
}

describe('requestId middleware', () => {
  it('generates a UUID when no request identifier is supplied', () => {
    const req = createRequest(undefined);
    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves a valid incoming X-Request-Id header', () => {
    const req = createRequest('upstream-request-123');

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe('upstream-request-123');
  });

  it('trims surrounding whitespace from an incoming request identifier', () => {
    const req = createRequest('  upstream-request-123  ');

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe('upstream-request-123');
  });

  it('generates a new identifier when the incoming header is empty', () => {
    const req = createRequest('');
    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a new identifier when the incoming header contains only whitespace', () => {
    const req = createRequest('   ');
    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('rejects oversized incoming request identifiers', () => {
    const req = createRequest('a'.repeat(129));

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).not.toBe('a'.repeat(129));

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('accepts an incoming request identifier at the maximum allowed length', () => {
    const incomingRequestId = 'a'.repeat(128);

    const req = createRequest(incomingRequestId);

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(req.requestId).toBe(incomingRequestId);
  });

  it('stores the same identifier in response locals', () => {
    const req = createRequest('request-123');

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.locals.requestId).toBe('request-123');

    expect(res.locals.requestId).toBe(req.requestId);
  });

  it('returns the request identifier through the response header', () => {
    const req = createRequest('request-123');

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'request-123');
  });

  it('returns the generated identifier through the response header', () => {
    const req = createRequest(undefined);
    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('continues middleware execution exactly once', () => {
    const req = createRequest('request-123');

    const res = createResponse();
    const next = vi.fn();

    requestId(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });
});
