/**
 * @file auth.controller.js
 * @description HTTP controllers for DispatchIQ authentication endpoints.
 *
 * Controllers translate validated HTTP requests into authentication service
 * calls and return consistent API responses. Authentication business rules,
 * password handling, token generation, and database operations remain outside
 * this layer.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { login, logout, refresh, register } from './auth.service.js';

/**
 * Registers a new user and returns the initial authentication session.
 *
 * @type {import('express').RequestHandler}
 */
export const registerController = asyncHandler(async (req, res) => {
  const result = await register(req.body);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    data: result,
  });
});

/**
 * Authenticates an existing user and returns a new session.
 *
 * @type {import('express').RequestHandler}
 */
export const loginController = asyncHandler(async (req, res) => {
  const result = await login(req.body);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Rotates a valid refresh token and returns a replacement token pair.
 *
 * @type {import('express').RequestHandler}
 */
export const refreshController = asyncHandler(async (req, res) => {
  const result = await refresh(req.body);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Revokes the supplied refresh token.
 *
 * Logout is idempotent, so unknown or already-revoked tokens still produce a
 * successful response.
 *
 * @type {import('express').RequestHandler}
 */
export const logoutController = asyncHandler(async (req, res) => {
  await logout(req.body);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: {
      message: 'Logged out successfully.',
    },
  });
});

/**
 * Returns the currently authenticated user.
 *
 * The authenticate middleware resolves and assigns the safe user object to
 * `req.user` before this controller executes.
 *
 * @type {import('express').RequestHandler}
 */
export const meController = asyncHandler(async (req, res) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: {
      user: req.user,
    },
  });
});
