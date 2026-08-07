/**
 * @file worker.controller.js
 * @description HTTP controllers for the DispatchIQ Worker Management API.
 *
 * Controllers translate validated Express request data into worker-service
 * operations and return consistent HTTP responses. Worker lifecycle rules,
 * health interpretation, pagination logic, and database access remain outside
 * this layer.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { getWorker, getWorkerHealth, listWorkers } from './worker.service.js';

/**
 * Returns a paginated collection of worker instances.
 *
 * Query parameters are validated and normalized by route middleware before
 * this controller executes.
 *
 * @type {import('express').RequestHandler}
 */
export const listWorkersController = asyncHandler(async (req, res) => {
  const result = await listWorkers(req.query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Returns detailed operational information for one worker instance.
 *
 * The worker identifier is validated before controller execution. Missing
 * workers are surfaced by the service as an operational WORKER_NOT_FOUND
 * error and handled by centralized error middleware.
 *
 * @type {import('express').RequestHandler}
 */
export const getWorkerController = asyncHandler(async (req, res) => {
  const worker = await getWorker(req.params.workerId);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: worker,
  });
});

/**
 * Returns cluster-level worker health and heartbeat information.
 *
 * This endpoint exposes operational state only. It does not mutate worker
 * lifecycle records or trigger recovery behavior.
 *
 * @type {import('express').RequestHandler}
 */
export const getWorkerHealthController = asyncHandler(async (_req, res) => {
  const health = await getWorkerHealth();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: health,
  });
});
