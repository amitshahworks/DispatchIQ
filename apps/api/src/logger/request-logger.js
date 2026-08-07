/**
 * @file request-logger.js
 * @description Structured HTTP request logging middleware for the DispatchIQ
 * API.
 *
 * The middleware records request completion using the centralized Pino logger
 * and includes correlation metadata such as request ID, HTTP method, path,
 * response status, execution duration, remote address, user agent, and
 * authenticated user information when available.
 *
 * Logging occurs when the response finishes so the final status code and total
 * request duration are captured accurately.
 */

import { logger } from './logger.js';

/**
 * Returns a high-resolution timestamp in nanoseconds.
 *
 * `process.hrtime.bigint()` is used instead of `Date.now()` so short request
 * durations can be measured accurately without depending on wall-clock time.
 *
 * @returns {bigint} High-resolution timestamp.
 */
function nowNs() {
  return process.hrtime.bigint();
}

/**
 * Converts a nanosecond duration into milliseconds.
 *
 * Milliseconds are rounded to three decimal places to provide useful
 * precision while keeping structured logs concise.
 *
 * @param {bigint} durationNs Duration measured in nanoseconds.
 * @returns {number} Duration in milliseconds.
 */
function toMilliseconds(durationNs) {
  return Number((Number(durationNs) / 1_000_000).toFixed(3));
}

/**
 * Resolves the most useful request path available from Express.
 *
 * `originalUrl` is preferred because it preserves the complete client-visible
 * route including mounted router prefixes and query parameters.
 *
 * @param {import('express').Request} req Express request.
 * @returns {string} Request path.
 */
function getRequestPath(req) {
  return req.originalUrl ?? req.url ?? req.path ?? '/';
}

/**
 * Builds structured metadata for a completed HTTP request.
 *
 * Authentication metadata is intentionally limited to non-sensitive
 * identifiers. Tokens, API keys, authorization headers, request bodies, and
 * other credential material are never logged here.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {number} durationMs Completed request duration.
 * @returns {Record<string, unknown>} Structured request-log metadata.
 */
function buildRequestLogContext(req, res, durationMs) {
  const context = {
    requestId: req.requestId ?? res.locals?.requestId,

    method: req.method,

    path: getRequestPath(req),

    statusCode: res.statusCode,

    durationMs,

    remoteAddress: req.ip ?? req.socket?.remoteAddress,

    userAgent: req.get?.('User-Agent'),
  };

  if (req.user?.id) {
    context.userId = req.user.id;
  }

  if (req.apiKey?.id) {
    context.apiKeyId = req.apiKey.id;
  }

  return context;
}

/**
 * Selects the log severity for a completed HTTP request.
 *
 * - 5xx responses are server failures and are logged as errors.
 * - 4xx responses represent client-visible failures and are logged as warnings.
 * - All successful and redirect responses are logged as informational events.
 *
 * @param {number} statusCode HTTP response status.
 * @returns {'info' | 'warn' | 'error'} Pino log method name.
 */
function getLogLevel(statusCode) {
  if (statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

/**
 * Logs one completed DispatchIQ HTTP request.
 *
 * This middleware does not log immediately when the request enters the
 * application. Instead, it registers a response `finish` listener so the log
 * reflects the final status code and complete processing duration.
 *
 * The listener is registered before downstream middleware executes, ensuring
 * synchronous responses are also observed.
 *
 * @type {import('express').RequestHandler}
 */
export function requestLogger(req, res, next) {
  const startedAt = nowNs();

  res.once('finish', () => {
    const durationMs = toMilliseconds(nowNs() - startedAt);

    const context = buildRequestLogContext(req, res, durationMs);

    const level = getLogLevel(res.statusCode);

    logger[level](context, 'HTTP request completed.');
  });

  next();
}
