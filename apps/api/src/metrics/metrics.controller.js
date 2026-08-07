/**
 * @file metrics.controller.js
 * @description HTTP controller for DispatchIQ platform metrics.
 *
 * The controller is intentionally thin. It delegates all reporting and
 * aggregation logic to the metrics service and is responsible only for
 * translating the service result into the standard API response contract.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { getPlatformMetrics } from './metrics.service.js';

/**
 * Returns a platform-wide operational metrics snapshot.
 *
 * @type {import('express').RequestHandler}
 */
export const getPlatformMetricsController = asyncHandler(async (req, res) => {
  const metrics = await getPlatformMetrics();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: metrics,
  });
});
