/**
 * @file index.js
 * @description Root Express router for DispatchIQ.
 *
 * Mounts service metadata, health checks, and versioned domain route modules.
 * New API domains should be registered here under `/api/v1`.
 */

import { checkDatabaseHealth } from '@dispatchiq/database';
import { HTTP_STATUS } from '@dispatchiq/shared';
import { Router } from 'express';

import { apiKeyRouter } from '../api-keys/api-key.routes.js';
import { authRouter } from '../auth/auth.routes.js';
import { jobRouter } from '../jobs/job.routes.js';
import { metricsRouter } from '../metrics/metrics.routes.js';
import { asyncHandler } from '../utils/async-handler.js';
import { workerRouter } from '../workers/worker.routes.js';

export const router = Router();

/**
 * Returns basic service metadata.
 */
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

/**
 * Returns API and database health information.
 */
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

/*
 * Versioned API domains.
 *
 * Authentication and API-key management remain separate because JWT sessions
 * are intended for interactive users while API keys are intended for
 * programmatic clients.
 */
router.use('/api/v1/auth', authRouter);
router.use('/api/v1/jobs', jobRouter);
router.use('/api/v1/metrics', metricsRouter);
router.use('/api/v1/api-keys', apiKeyRouter);
router.use('/api/v1/workers', workerRouter);
