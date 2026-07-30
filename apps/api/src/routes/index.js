/**
 * @file index.js
 * @description Root Express router. Mounts the service info and health
 * check endpoints. Later phases will mount additional route modules here
 * (auth, jobs, workers, api-keys).
 */

import { Router } from 'express';
import { checkDatabaseHealth } from '@dispatchiq/database';
import { HTTP_STATUS } from '@dispatchiq/shared';
import { asyncHandler } from '../utils/async-handler.js';

export const router = Router();

router.get('/', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
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
  asyncHandler(async (req, res) => {
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
