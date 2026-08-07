/**
 * @file server.js
 * @description Entry point for the DispatchIQ API process.
 *
 * Starts the HTTP server, records structured lifecycle logs through the
 * centralized Pino logger, and coordinates graceful shutdown for SIGINT and
 * SIGTERM.
 *
 * Shutdown is intentionally idempotent so repeated process signals cannot run
 * overlapping server-close or Prisma-disconnect operations.
 */

import { prisma } from '@dispatchiq/database';

import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger/index.js';

let isShuttingDown = false;

/**
 * Gracefully shuts down the HTTP server and disconnects Prisma.
 *
 * The shutdown sequence:
 *
 * 1. Prevents duplicate shutdown execution.
 * 2. Stops the server from accepting new connections.
 * 3. Allows existing in-flight requests to finish.
 * 4. Disconnects the Prisma client.
 * 5. Exits the process with the appropriate status code.
 *
 * @param {import('http').Server} server Active HTTP server.
 * @param {string} signal Process signal initiating shutdown.
 * @returns {Promise<void>}
 */
async function shutdown(server, signal) {
  if (isShuttingDown) {
    logger.debug(
      {
        signal,
      },
      'Shutdown already in progress.',
    );

    return;
  }

  isShuttingDown = true;

  logger.info(
    {
      signal,
    },
    'Graceful shutdown started.',
  );

  try {
    await new Promise((resolve, reject) => {
      /*
       * Stop accepting new connections while allowing existing requests to
       * finish before the callback executes.
       */
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await prisma.$disconnect();

    logger.info(
      {
        signal,
      },
      'Graceful shutdown completed.',
    );

    process.exit(0);
  } catch (error) {
    logger.error(
      {
        err: error,
        signal,
      },
      'Graceful shutdown failed.',
    );

    process.exit(1);
  }
}

/**
 * Starts the DispatchIQ HTTP server and registers process lifecycle handlers.
 *
 * Startup failures are logged as fatal process-level errors because the API
 * cannot serve traffic successfully when the listening socket cannot be
 * established.
 *
 * @returns {import('http').Server} Started HTTP server.
 */
export function start() {
  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
      },
      'DispatchIQ API started.',
    );
  });

  server.on('error', (error) => {
    logger.fatal(
      {
        err: error,
        port: env.PORT,
        environment: env.NODE_ENV,
      },
      'DispatchIQ API failed to start.',
    );

    process.exit(1);
  });

  process.on('SIGINT', () => {
    void shutdown(server, 'SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown(server, 'SIGTERM');
  });

  return server;
}

start();
