/**
 * @file app.js
 * @description Constructs and configures the DispatchIQ Express application.
 *
 * The application assembles security middleware, request parsing, correlation
 * metadata, structured request logging, rate limiting, routes, and centralized
 * error handling. Network binding remains the responsibility of server.js.
 */

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { requestLogger } from './logger/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { router } from './routes/index.js';
import { apiRateLimiter } from './security/rate-limit.js';

/**
 * Builds a fully configured Express application instance.
 *
 * Middleware ordering is intentional:
 *
 * 1. Security headers
 * 2. CORS
 * 3. Request body parsing
 * 4. Request correlation
 * 5. Structured HTTP logging
 * 6. Global API rate limiting
 * 7. Application routes
 * 8. 404 handling
 * 9. Centralized error handling
 *
 * Request correlation executes before logging and rate limiting so normal and
 * rate-limited responses can use the same request identifier.
 *
 * The global limiter is injectable for deterministic application integration
 * testing. Production callers normally omit this option and receive the
 * standard DispatchIQ API rate limiter.
 *
 * @param {{
 *   rateLimiter?: import('express').RequestHandler
 * }} [options] Application construction options.
 * @returns {import('express').Express} Configured Express application.
 */
export function createApp({ rateLimiter = apiRateLimiter } = {}) {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
    }),
  );

  app.use(express.json());

  app.use(
    express.urlencoded({
      extended: true,
    }),
  );

  /*
   * Correlation must precede logging and rate limiting so rejected requests
   * remain traceable through the same request identifier contract.
   */
  app.use(requestId);

  app.use(requestLogger);

  /*
   * Broad API abuse protection executes before application routes.
   * Authentication endpoints apply additional route-specific policies.
   */
  app.use(rateLimiter);

  app.use(router);

  app.use(notFound);

  app.use(errorHandler);

  return app;
}

export const app = createApp();
