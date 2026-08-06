/**
 * @file authorize.js
 * @description Role-based authorization middleware for protected DispatchIQ
 * routes.
 *
 * Authentication establishes who the requester is. This middleware performs
 * the separate authorization decision by checking whether the authenticated
 * user's role is permitted to access the requested operation.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';

/**
 * Creates middleware that permits only the supplied user roles.
 *
 * This middleware must be registered after `authenticate`, because it relies
 * on the safe authenticated user object assigned to `req.user`.
 *
 * @param {...string} allowedRoles Roles permitted to access the route.
 * @returns {import('express').RequestHandler} Express authorization middleware.
 * @throws {Error} When configured without at least one permitted role.
 *
 * @example
 * router.get(
 *   '/admin',
 *   authenticate,
 *   authorize('ADMIN'),
 *   adminController,
 * );
 */
export function authorize(...allowedRoles) {
  if (allowedRoles.length === 0) {
    throw new Error('authorize() requires at least one permitted role.');
  }

  const permittedRoles = new Set(allowedRoles);

  return (req, _res, next) => {
    if (!req.user) {
      next(
        new AppError('Authentication is required.', HTTP_STATUS.UNAUTHORIZED, {
          code: 'AUTHENTICATION_REQUIRED',
        }),
      );

      return;
    }

    if (!permittedRoles.has(req.user.role)) {
      next(
        new AppError('You do not have permission to perform this action.', HTTP_STATUS.FORBIDDEN, {
          code: 'INSUFFICIENT_PERMISSIONS',
        }),
      );

      return;
    }

    next();
  };
}
