/**
 * @file env.js
 * @description Validates, normalizes, and freezes all environment variables
 * required by the DispatchIQ API. This module is the single source of truth
 * for runtime configuration and should be imported wherever configuration
 * values are required.
 *
 * The configuration is validated during application startup so the API fails
 * fast when mandatory variables are missing or invalid, preventing undefined
 * runtime behavior later in the request lifecycle.
 */

import 'dotenv/config';

import { z } from 'zod';

/**
 * Runtime environment validation schema.
 */
const envSchema = z.object({
  /**
   * Current application environment.
   */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * HTTP server port.
   */
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Allowed frontend origin for CORS.
   */
  CORS_ORIGIN: z
    .string()
    .trim()
    .min(1, 'CORS_ORIGIN cannot be empty.')
    .default('http://localhost:5173'),

  /**
   * Secret used to sign JWT access tokens.
   *
   * Production deployments should use a long, cryptographically secure,
   * randomly generated secret.
   */
  JWT_ACCESS_SECRET: z
    .string()
    .trim()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long.'),

  /**
   * JWT access token lifetime.
   *
   * Examples:
   * - 15m
   * - 1h
   * - 2d
   */
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .trim()
    .min(1, 'JWT_ACCESS_EXPIRES_IN cannot be empty.')
    .default('15m'),

  /**
   * Number of days a refresh token remains valid.
   */
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),

  /**
   * bcrypt cost factor used when hashing passwords.
   *
   * Higher values increase security at the cost of CPU time.
   * The allowed range keeps development responsive while remaining secure.
   */
  BCRYPT_ROUNDS: z.coerce
    .number()
    .int()
    .min(10, 'BCRYPT_ROUNDS must be at least 10.')
    .max(14, 'BCRYPT_ROUNDS cannot exceed 14.')
    .default(12),
});

/**
 * Validates raw environment variables and returns an immutable configuration
 * object consumed throughout the API.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [source=process.env]
 * Raw environment variables.
 *
 * @returns {Readonly<{
 * NODE_ENV: 'development' | 'test' | 'production',
 * PORT: number,
 * CORS_ORIGIN: string,
 * JWT_ACCESS_SECRET: string,
 * JWT_ACCESS_EXPIRES_IN: string,
 * REFRESH_TOKEN_EXPIRES_DAYS: number,
 * BCRYPT_ROUNDS: number
 * }>}
 *
 * @throws {Error}
 * Thrown when one or more environment variables fail validation.
 */
export function parseEnv(source = process.env) {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    // Startup configuration errors must be visible immediately.
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);

    throw new Error('Invalid environment configuration.');
  }

  return Object.freeze({
    ...result.data,
  });
}

/**
 * Immutable validated environment configuration used by the DispatchIQ API.
 */
export const env = parseEnv();
