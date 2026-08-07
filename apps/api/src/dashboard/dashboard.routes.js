/**
 * @file dashboard.routes.js
 * @description Express routes for the DispatchIQ administrative dashboard.
 *
 * Dashboard endpoints expose operational metrics and health information for
 * platform administrators. All routes require JWT authentication and ADMIN
 * authorization.
 */

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import {
  getDashboardOverviewController,
  getSystemHealthController,
} from './dashboard.controller.js';

export const dashboardRouter = Router();

/*
 * Dashboard endpoints are operationally sensitive and therefore restricted to
 * authenticated administrators.
 */
dashboardRouter.use(authenticate, authorize('ADMIN'));

/**
 * Returns the administrative dashboard overview.
 */
dashboardRouter.get('/overview', getDashboardOverviewController);

/**
 * Returns overall platform health.
 */
dashboardRouter.get('/system-health', getSystemHealthController);
