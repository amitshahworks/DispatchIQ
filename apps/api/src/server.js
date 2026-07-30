/**
 * @file server.js
 * @description Entry point for the DispatchIQ API process. Starts the HTTP
 * server and manages graceful shutdown on SIGINT/SIGTERM.
 */

import { env } from './config/env.js';
import { app } from './app.js';
import { prisma } from '@dispatchiq/database';

let isShuttingDown = false;

/**
 * Gracefully shuts down the HTTP server and disconnects Prisma. Safe to call
 * more than once — only the first invocation performs the shutdown.
 *
 * @param {import('http').Server} server
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function shutdown(server, signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`Received ${signal}. Shutting down gracefully...`);

  try {
    await new Promise((resolve, reject) => {
      // Stop accepting new connections; existing in-flight requests finish.
      server.close((err) => (err ? reject(err) : resolve()));
    });

    await prisma.$disconnect();

    console.log('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * Starts the HTTP server and registers graceful shutdown handlers.
 */
function start() {
  const server = app.listen(env.PORT, () => {
    console.log(`DispatchIQ API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  server.on('error', (error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });

  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
}

start();
