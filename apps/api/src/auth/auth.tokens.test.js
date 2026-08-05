/**
 * @file auth.tokens.test.js
 * @description Unit tests for JWT access-token generation and verification.
 */

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { env } from '../config/env.js';
import { generateAccessToken, verifyAccessToken } from './auth.tokens.js';

describe('authentication access-token utilities', () => {
  const user = {
    userId: 'user-123',
    role: 'USER',
  };

  it('generates a signed JWT string', () => {
    const token = generateAccessToken(user);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies a generated access token', () => {
    const token = generateAccessToken(user);
    const decoded = verifyAccessToken(token);

    expect(decoded.sub).toBe(user.userId);
    expect(decoded.role).toBe(user.role);
    expect(decoded.iat).toEqual(expect.any(Number));
    expect(decoded.exp).toEqual(expect.any(Number));
  });

  it('does not include unnecessary user information', () => {
    const token = generateAccessToken(user);
    const decoded = verifyAccessToken(token);

    expect(decoded).not.toHaveProperty('passwordHash');
    expect(decoded).not.toHaveProperty('email');
    expect(decoded).not.toHaveProperty('refreshToken');
    expect(decoded).not.toHaveProperty('userId');
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-valid-jwt')).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign(
      {
        role: user.role,
      },
      'different_test_secret_abcdefghijklmnopqrstuvwxyz_123456',
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        subject: user.userId,
      },
    );

    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects an expired token', () => {
    const expiredToken = jwt.sign(
      {
        role: user.role,
      },
      env.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: -1,
        subject: user.userId,
      },
    );

    expect(() => verifyAccessToken(expiredToken)).toThrow();
  });

  it('rejects a validly signed token missing required claims', () => {
    const tokenWithoutRole = jwt.sign({}, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
      subject: user.userId,
    });

    expect(() => verifyAccessToken(tokenWithoutRole)).toThrow(
      'Access token contains invalid claims.',
    );
  });
});
