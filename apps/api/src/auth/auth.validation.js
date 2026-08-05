/**
 * @file auth.validation.js
 * @description Zod schemas for validating DispatchIQ authentication requests.
 * These schemas validate and normalize only client-supplied input. They do not
 * perform database lookups or authentication business logic.
 */

import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .email('A valid email address is required.')
  .transform((email) => email.toLowerCase());

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

const refreshTokenSchema = z.string().trim().min(1, 'Refresh token is required.');

/**
 * Validates user registration input.
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Validates user login input.
 *
 * Login intentionally applies only basic password presence validation so weak
 * but existing legacy passwords are not rejected before credential checking.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

/**
 * Validates refresh-token rotation input.
 */
export const refreshSchema = z.object({
  refreshToken: refreshTokenSchema,
});

/**
 * Validates logout input.
 */
export const logoutSchema = z.object({
  refreshToken: refreshTokenSchema,
});
