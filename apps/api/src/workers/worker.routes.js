/**
 * @file worker.routes.js
 * @description Express routes for DispatchIQ Worker Management operations.
 *
 * Worker topology, heartbeat state, execution history, and cluster-health
 * information are operationally sensitive. All worker-management endpoints
 * therefore require JWT authentication and ADMIN authorization.
 *
 * The module is intentionally read-only. Worker lifecycle mutations continue
 * to belong to the worker runtime and recovery subsystems.
 */

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  getWorkerController,
  getWorkerHealthController,
  listWorkersController,
} from './worker.controller.js';
import { listWorkersQuerySchema, workerIdParamsSchema } from './worker.validation.js';

export const workerRouter = Router();

/**
 * Worker Management API security policy.
 *
 * JWT authentication is required because these routes expose administrative
 * infrastructure information. API-key authentication is intentionally not
 * accepted for this operational surface.
 */
workerRouter.use(authenticate, authorize('ADMIN'));

/**
 * Returns cluster-level worker health.
 *
 * This route must be registered before `/:workerId` so the literal "health"
 * segment is never interpreted as a worker identifier.
 */
workerRouter.get('/health', getWorkerHealthController);

/**
 * Returns a paginated worker collection with optional lifecycle filtering.
 */
workerRouter.get('/', validate(listWorkersQuerySchema, 'query'), listWorkersController);

/**
 * Returns detailed operational information for one worker instance.
 */
workerRouter.get('/:workerId', validate(workerIdParamsSchema, 'params'), getWorkerController);
