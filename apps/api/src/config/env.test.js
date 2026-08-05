/**
 * Tests API environment parsing, defaults, coercion, and validation.
 */

import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies safe development defaults', () => {
    const config = parseEnv({});

    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGIN: 'http://localhost:5173',
    });
  });

  it('normalizes supplied environment values', () => {
    const config = parseEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      CORS_ORIGIN: 'https://dispatchiq.example.com',
    });

    expect(config).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      CORS_ORIGIN: 'https://dispatchiq.example.com',
    });
  });

  it('rejects an unsupported environment name', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'staging',
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('rejects a non-positive port', () => {
    expect(() =>
      parseEnv({
        PORT: '0',
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('returns an immutable configuration object', () => {
    const config = parseEnv({});

    expect(Object.isFrozen(config)).toBe(true);
  });
});
