/**
 * @file job.controller.js
 * @description HTTP controllers for authenticated DispatchIQ job-management
 * endpoints.
 *
 * Controllers read normalized request data, call the job service, and return
 * consistent HTTP responses. Job lifecycle rules, ownership checks, and
 * persistence logic remain in the service and repository layers.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { asyncHandler } from '../utils/async-handler.js';
import { cancelJob, createJob, getJob, listJobs } from './job.service.js';

/**
 * Creates a job owned by the authenticated user.
 *
 * @type {import('express').RequestHandler}
 */
export const createJobController = asyncHandler(async (req, res) => {
  const job = await createJob(req.user.id, req.body);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    data: job,
  });
});

/**
 * Returns the authenticated user's filtered and paginated jobs.
 *
 * @type {import('express').RequestHandler}
 */
export const listJobsController = asyncHandler(async (req, res) => {
  const result = await listJobs(req.user.id, req.query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
});

/**
 * Returns one user-owned job with attempts and lifecycle logs.
 *
 * @type {import('express').RequestHandler}
 */
export const getJobController = asyncHandler(async (req, res) => {
  const job = await getJob(req.user.id, req.params.jobId);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: job,
  });
});

/**
 * Cancels a user-owned job whose lifecycle state permits cancellation.
 *
 * @type {import('express').RequestHandler}
 */
export const cancelJobController = asyncHandler(async (req, res) => {
  const job = await cancelJob(req.user.id, req.params.jobId);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: job,
  });
});
