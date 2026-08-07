/**
 * @file dashboard.controller.js
 * @description HTTP controllers for the DispatchIQ administrative dashboard.
 *
 * Controllers translate authenticated administrative HTTP requests into
 * dashboard-service operations and return consistent API responses.
 *
 * Dashboard composition, metrics interpretation, and system-health
 * classification remain isolated in the service layer.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { getDashboardOverview, getSystemHealth } from './dashboard.service.js';

/**
 * Returns the administrative dashboard overview.
 *
 * The overview exposes queue, worker, execution, and throughput information
 * already normalized by the dashboard and metrics services.
 *
 * @type {import('express').RequestHandler}
 */
export const getDashboardOverviewController = asyncHandler(async (_req, res) => {
  const overview = await getDashboardOverview();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: overview,
  });
});

/**
 * Returns the high-level DispatchIQ system-health summary.
 *
 * The response contains overall health together with queue, worker, and
 * execution subsystem classifications.
 *
 * @type {import('express').RequestHandler}
 */
export const getSystemHealthController = asyncHandler(async (_req, res) => {
  const health = await getSystemHealth();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: health,
  });
});
