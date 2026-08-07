/**
 * @file app.js
 * @description Constructs and configures the DispatchIQ Express application.
 *
 * The application assembles security middleware, request parsing, correlation
 * metadata, structured request logging, routes, and centralized error
 * handling. Network binding remains the responsibility of server.js.
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
 * 6. Application routes
 * 7. 404 handling
 * 8. Centralized error handling
 *
 * Request correlation is registered before structured logging so every
 * completed HTTP request can be associated with the same request identifier.
 *
 * @returns {import('express').Express} Configured Express application.
 */
export function createApp() {
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
   * Every request receives a stable correlation identifier before logging,
   * authentication, validation, routing, or error handling occurs.
   */
  app.use(requestId);

  /*
   * Structured request logging replaces Morgan. The logger records completed
   * requests together with request ID, status code, duration, path, and safe
   * authentication context.
   */
  app.use(requestLogger);

  app.use(router);

  app.use(notFound);

  app.use(errorHandler);

  return app;
}

export const app = createApp();
