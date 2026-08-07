/**
 * @file logger.js
 * @description Centralized structured logger for the DispatchIQ API.
 *
 * The logger uses Pino to provide high-performance structured logging across
 * HTTP requests, application errors, startup/shutdown events, authentication
 * flows, and future operational telemetry.
 *
 * Development environments use pino-pretty for readable console output.
 * Production environments emit machine-readable JSON suitable for ingestion
 * by systems such as CloudWatch, Loki, Datadog, or Elasticsearch.
 */

import pino from 'pino';

import { env } from '../config/env.js';

/**
 * Builds the transport configuration used for human-readable development
 * logging.
 *
 * Pretty printing is intentionally disabled in production because structured
 * JSON is more suitable for centralized log aggregation and analysis.
 *
 * @returns {import('pino').TransportSingleOptions} Pino transport options.
 */
function createDevelopmentTransport() {
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

/**
 * Creates the application-wide DispatchIQ API logger.
 *
 * Log level policy:
 *
 * - development → debug
 * - test        → silent
 * - production  → info
 *
 * Test logging is disabled by default to keep Vitest output deterministic and
 * readable. Individual logger behavior is verified separately through unit
 * tests.
 *
 * @returns {import('pino').Logger} Configured Pino logger.
 */
export function createLogger() {
  const isDevelopment = env.NODE_ENV === 'development';
  const isTest = env.NODE_ENV === 'test';

  return pino({
    level: isTest ? 'silent' : isDevelopment ? 'debug' : 'info',

    base: {
      service: 'dispatchiq-api',
      environment: env.NODE_ENV,
    },

    timestamp: pino.stdTimeFunctions.isoTime,

    ...(isDevelopment
      ? {
          transport: createDevelopmentTransport(),
        }
      : {}),
  });
}

/**
 * Shared API logger instance.
 *
 * Application modules should normally import this singleton rather than
 * constructing independent logger instances so formatting, metadata, and log
 * level policy remain consistent across the service.
 */
export const logger = createLogger();

/**
 * Creates a child logger enriched with persistent contextual metadata.
 *
 * Child loggers are useful for request correlation, worker identifiers,
 * authentication context, or subsystem-specific logging without repeatedly
 * passing the same fields to every log call.
 *
 * @param {Record<string, unknown>} bindings Persistent structured metadata.
 * @returns {import('pino').Logger} Context-enriched child logger.
 */
export function createChildLogger(bindings) {
  return logger.child(bindings);
}
