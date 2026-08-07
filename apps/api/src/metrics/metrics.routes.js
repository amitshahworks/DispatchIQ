/**
 * @file metrics.routes.js
 * @description Route definitions for DispatchIQ platform operational metrics.
 *
 * Platform metrics expose infrastructure-wide information including queue
 * depth, worker health, execution reliability, and throughput. Access is
 * therefore restricted to authenticated administrators rather than ordinary
 * user accounts.
 */

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { getPlatformMetricsController } from './metrics.controller.js';

const router = Router();

/**
 * Returns the current platform-wide operational metrics snapshot.
 *
 * Middleware order is security-sensitive:
 *
 * 1. Authenticate the request and establish req.user.
 * 2. Require the ADMIN role.
 * 3. Delegate metric generation to the controller.
 */
router.get('/', authenticate, authorize('ADMIN'), getPlatformMetricsController);

export { router as metricsRouter };
