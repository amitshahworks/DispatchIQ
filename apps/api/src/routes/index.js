/**
 * @file index.js
 * @description Root Express router for DispatchIQ.
 *
 * Mounts service metadata, database health checks, and versioned API route
 * modules. New domain routers should be registered here under `/api/v1`.
 */

import { checkDatabaseHealth } from '@dispatchiq/database';
import { HTTP_STATUS } from '@dispatchiq/shared';
import { Router } from 'express';

import { authRouter } from '../auth/auth.routes.js';
import { asyncHandler } from '../utils/async-handler.js';

export const router = Router();

router.get('/', (_req, res) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: {
      service: 'DispatchIQ API',
      status: 'ok',
      version: '1.0.0',
    },
  });
});

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const isHealthy = await checkDatabaseHealth();

    if (!isHealthy) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        success: false,
        data: {
          status: 'unhealthy',
          database: 'disconnected',
        },
      });
    }

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      data: {
        status: 'healthy',
        database: 'connected',
      },
    });
  }),
);

router.use('/api/v1/auth', authRouter);
