/**
 * @file job.routes.js
 * @description Express routes for authenticated DispatchIQ job-management
 * operations.
 *
 * Every route requires a valid access token. Request validation is applied
 * before controllers execute so controllers receive normalized body, query,
 * and route-parameter data.
 */

import { Router } from 'express';

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

jobRouter.use(authenticate);

jobRouter.post('/', validate(createJobSchema), createJobController);

jobRouter.get('/', validate(listJobsQuerySchema, 'query'), listJobsController);

jobRouter.get('/:jobId', validate(jobIdParamsSchema, 'params'), getJobController);

jobRouter.post('/:jobId/cancel', validate(jobIdParamsSchema, 'params'), cancelJobController);
