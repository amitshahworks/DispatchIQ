/**
 * @file rate-limit.js
 * @description Centralized HTTP rate-limiting policies for the DispatchIQ API.
 *
 * Rate limiting protects public and authenticated API surfaces from excessive
 * request volume, brute-force authentication attempts, credential abuse, and
 * accidental client retry storms.
 *
 * Policies are intentionally defined in one module so limits, response
 * contracts, and operational behavior remain consistent across route modules.
 *
 * The current implementation uses express-rate-limit's default in-process
 * memory store. This is suitable for the current single API process. A shared
 * external store can be introduced later if the API is horizontally scaled
 * across multiple application instances.
 */

import { rateLimit } from 'express-rate-limit';

const TOO_MANY_REQUESTS = 429;

const ONE_MINUTE_MS = 60 * 1_000;
const FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

/**
 * Resolves the request identifier associated with a rate-limited request.
 *
 * Request correlation is populated earlier in the Express middleware chain.
 * The response-local value remains a defensive fallback.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {string | undefined} Request correlation identifier.
 */
function getRequestId(req, res) {
  return req.requestId ?? res.locals?.requestId;
}

/**
 * Creates a DispatchIQ rate limiter with the standard API error contract.
 *
 * Rate-limit responses deliberately use the same `{ success, error }` shape
 * used by centralized application error handling. This keeps client behavior
 * predictable even though express-rate-limit terminates the request before it
 * reaches controllers.
 *
 * @param {{
 *   windowMs: number,
 *   limit: number,
 *   code: string,
 *   message: string,
 *   skipSuccessfulRequests?: boolean
 * }} policy Rate-limit policy.
 * @returns {import('express').RequestHandler} Configured rate-limit middleware.
 */
export function createRateLimiter({
  windowMs,
  limit,
  code,
  message,
  skipSuccessfulRequests = false,
}) {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('Rate limiter windowMs must be a positive integer.');
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Rate limiter limit must be a positive integer.');
  }

  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('Rate limiter code must be a non-empty string.');
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Rate limiter message must be a non-empty string.');
  }

  return rateLimit({
    windowMs,
    limit,

    /*
     * Standards-based RateLimit response headers allow well-behaved clients
     * to understand remaining quota and retry timing without relying on
     * deprecated X-RateLimit-* headers.
     */
    standardHeaders: 'draft-8',
    legacyHeaders: false,

    skipSuccessfulRequests,

    handler(req, res) {
      return res.status(TOO_MANY_REQUESTS).json({
        success: false,
        error: {
          code,
          message,
          requestId: getRequestId(req, res),
        },
      });
    },
  });
}

/**
 * General API protection.
 *
 * This limiter protects the complete HTTP surface from accidental retry loops,
 * aggressive scraping, and basic volumetric abuse while still allowing normal
 * application traffic.
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: ONE_MINUTE_MS,
  limit: 120,
  code: 'API_RATE_LIMIT_EXCEEDED',
  message: 'Too many requests. Please try again shortly.',
});

/**
 * Login brute-force protection.
 *
 * Successful authentication attempts are excluded from the counter so normal
 * repeated use does not consume the failure budget. Failed login attempts
 * continue to count toward the limit.
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 10,
  code: 'LOGIN_RATE_LIMIT_EXCEEDED',
  message: 'Too many login attempts. Please try again later.',
  skipSuccessfulRequests: true,
});

/**
 * Registration abuse protection.
 *
 * Account creation receives a significantly lower request allowance than
 * ordinary API traffic because legitimate clients rarely need to create many
 * accounts from one source within a short period.
 */
export const registrationRateLimiter = createRateLimiter({
  windowMs: ONE_HOUR_MS,
  limit: 5,
  code: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
  message: 'Too many registration attempts. Please try again later.',
});

/**
 * Refresh-token endpoint protection.
 *
 * Refresh requests are legitimate recurring traffic, so the allowance is
 * higher than login or registration while still preventing tight retry loops
 * involving invalid or expired refresh tokens.
 */
export const refreshTokenRateLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  code: 'REFRESH_RATE_LIMIT_EXCEEDED',
  message: 'Too many token refresh requests. Please try again later.',
});
