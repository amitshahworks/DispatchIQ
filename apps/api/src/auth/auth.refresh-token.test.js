/**
 * @file auth.refresh-token.test.js
 * @description Unit tests for opaque refresh-token generation, hashing, and
 * expiration calculation.
 */

import { describe, expect, it } from 'vitest';

import { env } from '../config/env.js';
import {
  calculateRefreshTokenExpiry,
  generateRefreshToken,
  hashRefreshToken,
} from './auth.refresh-token.js';

describe('authentication refresh-token utilities', () => {
  it('generates a cryptographically random token string', () => {
    const token = generateRefreshToken();

    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-f0-9]+$/);
    expect(token).toHaveLength(96);
  });

  it('generates a different token on every call', () => {
    const firstToken = generateRefreshToken();
    const secondToken = generateRefreshToken();

    expect(firstToken).not.toBe(secondToken);
  });

  it('produces a deterministic SHA-256 hash', () => {
    const token = 'sample-refresh-token';

    const firstHash = hashRefreshToken(token);
    const secondHash = hashRefreshToken(token);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different tokens', () => {
    const firstHash = hashRefreshToken('first-refresh-token');
    const secondHash = hashRefreshToken('second-refresh-token');

    expect(firstHash).not.toBe(secondHash);
  });

  it('calculates expiration using the configured lifetime', () => {
    const issuedAt = new Date('2026-08-05T12:00:00.000Z');
    const expiresAt = calculateRefreshTokenExpiry(issuedAt);

    const expectedExpiration = new Date(issuedAt);

    expectedExpiration.setUTCDate(expectedExpiration.getUTCDate() + env.REFRESH_TOKEN_EXPIRES_DAYS);

    expect(expiresAt).toEqual(expectedExpiration);
  });

  it('does not mutate the supplied issue date', () => {
    const issuedAt = new Date('2026-08-05T12:00:00.000Z');
    const originalTimestamp = issuedAt.getTime();

    calculateRefreshTokenExpiry(issuedAt);

    expect(issuedAt.getTime()).toBe(originalTimestamp);
  });

  it('defaults the issue date to the current time', () => {
    const before = Date.now();
    const expiresAt = calculateRefreshTokenExpiry();
    const after = Date.now();

    const lifetimeMilliseconds = env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + lifetimeMilliseconds);

    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + lifetimeMilliseconds);
  });
});
