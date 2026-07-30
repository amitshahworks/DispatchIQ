/**
 * @file app.js
 * @description Constructs and configures the Express application. Does not
 * start listening — server.js is responsible for binding to a port.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { router } from './routes/index.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';

/**
 * Builds a fully configured Express application instance.
 *
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
