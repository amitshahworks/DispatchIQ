/**
 * @file auth.validation.test.js
 * @description Unit tests for DispatchIQ authentication request schemas.
 */

import { describe, expect, it } from 'vitest';

import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.validation.js';

describe('authentication validation schemas', () => {
  describe('registerSchema', () => {
    it('accepts valid registration input and normalizes email', () => {
      const result = registerSchema.parse({
        email: '  Amit@Example.COM  ',
        password: 'SecurePassword123',
      });

      expect(result).toEqual({
        email: 'amit@example.com',
        password: 'SecurePassword123',
      });
    });

    it('rejects an invalid email address', () => {
      const result = registerSchema.safeParse({
        email: 'invalid-email',
        password: 'SecurePassword123',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a password shorter than eight characters', () => {
      const result = registerSchema.safeParse({
        email: 'amit@example.com',
        password: 'Short1A',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a password without an uppercase letter', () => {
      const result = registerSchema.safeParse({
        email: 'amit@example.com',
        password: 'securepassword123',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a password without a lowercase letter', () => {
      const result = registerSchema.safeParse({
        email: 'amit@example.com',
        password: 'SECUREPASSWORD123',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a password without a number', () => {
      const result = registerSchema.safeParse({
        email: 'amit@example.com',
        password: 'SecurePassword',
      });

      expect(result.success).toBe(false);
    });

    it('strips unrecognized fields', () => {
      const result = registerSchema.parse({
        email: 'amit@example.com',
        password: 'SecurePassword123',
        role: 'ADMIN',
      });

      expect(result).toEqual({
        email: 'amit@example.com',
        password: 'SecurePassword123',
      });
    });
  });

  describe('loginSchema', () => {
    it('accepts valid login input and normalizes email', () => {
      const result = loginSchema.parse({
        email: '  Amit@Example.COM ',
        password: 'any-existing-password',
      });

      expect(result).toEqual({
        email: 'amit@example.com',
        password: 'any-existing-password',
      });
    });

    it('rejects an empty password', () => {
      const result = loginSchema.safeParse({
        email: 'amit@example.com',
        password: '',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('refreshSchema', () => {
    it('accepts a non-empty refresh token', () => {
      const result = refreshSchema.parse({
        refreshToken: 'raw-refresh-token',
      });

      expect(result).toEqual({
        refreshToken: 'raw-refresh-token',
      });
    });

    it('rejects an empty refresh token', () => {
      const result = refreshSchema.safeParse({
        refreshToken: '   ',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('logoutSchema', () => {
    it('accepts a non-empty refresh token', () => {
      const result = logoutSchema.parse({
        refreshToken: 'raw-refresh-token',
      });

      expect(result).toEqual({
        refreshToken: 'raw-refresh-token',
      });
    });

    it('rejects a missing refresh token', () => {
      const result = logoutSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });
});
