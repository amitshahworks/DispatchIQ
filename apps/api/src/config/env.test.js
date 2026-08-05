/**
 * Tests API environment parsing, defaults, coercion, and validation.
 */

import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

const VALID_JWT_SECRET = 'dispatchiq_test_access_secret_abcdefghijklmnopqrstuvwxyz_123456';

describe('parseEnv', () => {
  it('applies safe development defaults', () => {
    const config = parseEnv({
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });

    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      JWT_ACCESS_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_DAYS: 7,
      BCRYPT_ROUNDS: 12,
    });
  });

  it('normalizes supplied environment values', () => {
    const config = parseEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      CORS_ORIGIN: 'https://dispatchiq.example.com',
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      JWT_ACCESS_EXPIRES_IN: '30m',
      REFRESH_TOKEN_EXPIRES_DAYS: '14',
      BCRYPT_ROUNDS: '13',
    });

    expect(config).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      CORS_ORIGIN: 'https://dispatchiq.example.com',
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      JWT_ACCESS_EXPIRES_IN: '30m',
      REFRESH_TOKEN_EXPIRES_DAYS: 14,
      BCRYPT_ROUNDS: 13,
    });
  });

  it('rejects an unsupported environment name', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'staging',
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('rejects a non-positive port', () => {
    expect(() =>
      parseEnv({
        PORT: '0',
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() =>
      parseEnv({
        JWT_ACCESS_SECRET: 'too-short',
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('rejects bcrypt rounds below the allowed minimum', () => {
    expect(() =>
      parseEnv({
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
        BCRYPT_ROUNDS: '9',
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('rejects bcrypt rounds above the allowed maximum', () => {
    expect(() =>
      parseEnv({
        JWT_ACCESS_SECRET: VALID_JWT_SECRET,
        BCRYPT_ROUNDS: '15',
      }),
    ).toThrow('Invalid environment configuration.');
  });

  it('returns an immutable configuration object', () => {
    const config = parseEnv({
      JWT_ACCESS_SECRET: VALID_JWT_SECRET,
    });

    expect(Object.isFrozen(config)).toBe(true);
  });
});
