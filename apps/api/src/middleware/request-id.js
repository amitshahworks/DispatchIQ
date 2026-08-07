/**
 * @file request-id.js
 * @description Assigns a stable request identifier to every DispatchIQ HTTP
 * request.
 *
 * Request identifiers make production debugging, structured logging, audit
 * trails, and distributed tracing significantly easier by allowing all events
 * associated with one HTTP request to be correlated.
 *
 * The middleware accepts a valid incoming `X-Request-Id` header when present
 * and otherwise generates a cryptographically strong UUID. The resolved
 * identifier is exposed on both the request and response context and returned
 * to the client through the `X-Request-Id` response header.
 */

import { randomUUID } from 'node:crypto';

const REQUEST_ID_HEADER = 'X-Request-Id';
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Normalizes an incoming request identifier.
 *
 * Client-provided identifiers are accepted only when they are non-empty,
 * trimmed strings within the configured maximum length. This prevents
 * malformed or unexpectedly large header values from entering logs and audit
 * records.
 *
 * @param {unknown} value Incoming request identifier.
 * @returns {string | null} Normalized request identifier, or null when the
 * supplied value is invalid.
 */
function normalizeRequestId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > MAX_REQUEST_ID_LENGTH) {
    return null;
  }

  return normalized;
}

/**
 * Resolves the request identifier for an incoming HTTP request.
 *
 * A valid caller-provided `X-Request-Id` is preserved to support correlation
 * across trusted upstream systems. Otherwise a fresh UUID is generated.
 *
 * @param {import('express').Request} req Express request.
 * @returns {string} Resolved request identifier.
 */
function resolveRequestId(req) {
  const incomingRequestId = normalizeRequestId(req.get(REQUEST_ID_HEADER));

  return incomingRequestId ?? randomUUID();
}

/**
 * Adds request-correlation metadata to the Express request/response lifecycle.
 *
 * On success:
 *
 * - `req.requestId` contains the resolved identifier.
 * - `res.locals.requestId` contains the same identifier.
 * - `X-Request-Id` is returned in the HTTP response.
 *
 * The middleware must be registered early in the application pipeline so
 * downstream authentication, validation, logging, metrics, and error handling
 * can reliably access the same request identifier.
 *
 * @type {import('express').RequestHandler}
 */
export function requestId(req, res, next) {
  const resolvedRequestId = resolveRequestId(req);

  req.requestId = resolvedRequestId;
  res.locals.requestId = resolvedRequestId;

  res.setHeader(REQUEST_ID_HEADER, resolvedRequestId);

  next();
}
