/**
 * @file auth.routes.js
 * @description Express routes for DispatchIQ authentication operations.
 *
 * Public routes validate client input before invoking their controllers.
 * The current-user endpoint requires a valid JWT access token through the
 * authenticate middleware.
 */

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from './auth.controller.js';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.validation.js';
import {
  loginRateLimiter,
  refreshTokenRateLimiter,
  registrationRateLimiter,
} from '../security/rate-limit.js';

export const authRouter = Router();

authRouter.post('/register', registrationRateLimiter, validate(registerSchema), registerController);

authRouter.post('/login', loginRateLimiter, validate(loginSchema), loginController);

authRouter.post('/refresh', refreshTokenRateLimiter, validate(refreshSchema), refreshController);

authRouter.post('/logout', validate(logoutSchema), logoutController);

authRouter.get('/me', authenticate, meController);
