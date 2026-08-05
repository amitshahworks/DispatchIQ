/**
 * @file auth.password.js
 * @description Password hashing and verification utilities for DispatchIQ
 * authentication. Uses the validated bcrypt cost factor from API
 * configuration and never handles user records or HTTP concerns.
 */

import bcrypt from 'bcryptjs';

import { env } from '../config/env.js';

/**
 * Hashes a plain-text password using bcrypt.
 *
 * @param {string} password Plain-text password supplied during registration.
 * @returns {Promise<string>} Secure bcrypt password hash.
 */
export function hashPassword(password) {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

/**
 * Verifies a plain-text password against a stored bcrypt hash.
 *
 * @param {string} password Plain-text password supplied during login.
 * @param {string} passwordHash Stored bcrypt password hash.
 * @returns {Promise<boolean>} True when the password matches; otherwise false.
 */
export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
