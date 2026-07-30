/**
 * @file env.js
 * @description Validates and normalizes process.env into an immutable
 * configuration object. Loads dotenv directly (rather than relying on it as
 * a side effect of another package) so environment values are guaranteed to
 * be populated before this module parses them, regardless of import order.
 */

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
});

/**
 * Validates a raw environment source against the DispatchIQ API's expected
 * shape and returns a frozen, normalized configuration object.
 *
 * @param {NodeJS.ProcessEnv} [source=process.env] - Raw environment source.
 * @returns {Readonly<{ NODE_ENV: 'development' | 'test' | 'production', PORT: number, CORS_ORIGIN: string }>}
 * @throws {Error} If the environment fails validation.
 */
export function parseEnv(source = process.env) {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration.');
  }

  return Object.freeze({ ...result.data });
}

/**
 * Validated, normalized, immutable environment configuration for the
 * current process.
 */
export const env = parseEnv();
