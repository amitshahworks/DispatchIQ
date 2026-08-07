/**
 * @file job.routes.js
 * @description Express routes for DispatchIQ job-management operations.
 *
 * Job submission supports both JWT access tokens and API keys so external
 * services can enqueue work programmatically. Job inspection and lifecycle
 * management remain JWT-only because those endpoints expose user-facing
 * account data and management capabilities.
 *
 * Request validation runs after authentication and before controllers so
 * downstream layers receive normalized body, query, and route-parameter data.
 */

import { Router } from 'express';

import { authenticateAny } from '../middleware/authenticate-any.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import {
  cancelJobController,
  createJobController,
  getJobController,
  listJobsController,
} from './job.controller.js';
import { createJobSchema, jobIdParamsSchema, listJobsQuerySchema } from './job.validation.js';

export const jobRouter = Router();

/**
 * Creates a job for the authenticated principal.
 *
 * Supported authentication:
 *
 * - JWT access token for interactive clients.
 * - X-API-Key for programmatic clients.
 *
 * Both authentication methods resolve the owning account into `req.user`, so
 * the controller and service continue enforcing job ownership using the same
 * user identifier regardless of credential type.
 */
jobRouter.post('/', authenticateAny, validate(createJobSchema), createJobController);

/**
 * Returns jobs owned by the authenticated user.
 *
 * Job-management reads remain JWT-only. API keys are currently scoped to job
 * submission rather than account-management operations.
 */
jobRouter.get('/', authenticate, validate(listJobsQuerySchema, 'query'), listJobsController);

/**
 * Returns one user-owned job with attempts and lifecycle logs.
 *
 * JWT authentication remains required for job inspection.
 */
jobRouter.get('/:jobId', authenticate, validate(jobIdParamsSchema, 'params'), getJobController);

/**
 * Cancels one user-owned job whose lifecycle state permits cancellation.
 *
 * Cancellation remains JWT-only because API keys currently provide job
 * submission capability rather than broader lifecycle-management authority.
 */
jobRouter.post(
  '/:jobId/cancel',
  authenticate,
  validate(jobIdParamsSchema, 'params'),
  cancelJobController,
);
