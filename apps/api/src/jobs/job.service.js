/**
 * @file job.service.js
 * @description Business logic for DispatchIQ job management.
 *
 * This service coordinates job creation, idempotency checks, ownership-safe
 * retrieval, pagination, and cancellation rules. HTTP concerns belong to the
 * controller layer, while Prisma access remains in the repository layer.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';
import {
  countJobsForUser,
  createJob as createJobRecord,
  findJobByIdempotencyKey,
  findJobByIdForUser,
  findJobDetailsByIdForUser,
  findJobsForUser,
  transitionJobStatus,
} from './job.repository.js';

const CANCELLABLE_JOB_STATUSES = Object.freeze(['SCHEDULED', 'QUEUED', 'RETRYING']);

/**
 * Determines the initial lifecycle state for a newly submitted job.
 *
 * Jobs whose availability time is in the future are scheduled. Jobs available
 * immediately or in the past are queued for worker pickup.
 *
 * @param {Date} availableAt Earliest time the job may be claimed.
 * @param {Date} now Current application time.
 * @returns {'SCHEDULED' | 'QUEUED'} Initial job status.
 */
function determineInitialStatus(availableAt, now) {
  return availableAt.getTime() > now.getTime() ? 'SCHEDULED' : 'QUEUED';
}

/**
 * Creates a new user-owned job.
 *
 * When an idempotency key is supplied, an existing job created by the same
 * user with that key is returned instead of creating a duplicate record.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {{
 *   type: string,
 *   priority: string,
 *   payload: Record<string, unknown>,
 *   idempotencyKey?: string,
 *   maxAttempts: number,
 *   availableAt?: Date
 * }} input Validated job submission input.
 * @param {Date} [now=new Date()] Current application time.
 * @returns {Promise<object>} Existing idempotent job or newly created job.
 */
export async function createJob(userId, input, now = new Date()) {
  if (input.idempotencyKey) {
    const existingJob = await findJobByIdempotencyKey({
      userId,
      idempotencyKey: input.idempotencyKey,
    });

    if (existingJob) {
      return existingJob;
    }
  }

  const availableAt = input.availableAt ?? now;
  const status = determineInitialStatus(availableAt, now);

  return createJobRecord({
    userId,
    type: input.type,
    status,
    priority: input.priority,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    maxAttempts: input.maxAttempts,
    availableAt,
  });
}

/**
 * Returns one user-owned job with its execution history.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {string} jobId Job identifier.
 * @returns {Promise<object>} Detailed job record.
 * @throws {AppError} When the job does not exist or belongs to another user.
 */
export async function getJob(userId, jobId) {
  const job = await findJobDetailsByIdForUser({
    userId,
    jobId,
  });

  if (!job) {
    throw new AppError('Job was not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'JOB_NOT_FOUND',
    });
  }

  return job;
}

/**
 * Returns a filtered and paginated list of jobs owned by one user.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {{
 *   page: number,
 *   limit: number,
 *   status?: string,
 *   type?: string
 * }} query Validated listing query.
 * @returns {Promise<{
 *   items: object[],
 *   pagination: {
 *     page: number,
 *     limit: number,
 *     totalItems: number,
 *     totalPages: number
 *   }
 * }>} Paginated job collection.
 */
export async function listJobs(userId, query) {
  const skip = (query.page - 1) * query.limit;

  const [items, totalItems] = await Promise.all([
    findJobsForUser({
      userId,
      skip,
      take: query.limit,
      status: query.status,
      type: query.type,
    }),
    countJobsForUser({
      userId,
      status: query.status,
      type: query.type,
    }),
  ]);

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.limit),
    },
  };
}

/**
 * Cancels a user-owned job when its current lifecycle state permits it.
 *
 * Cancellation is allowed only for jobs that have not completed terminal
 * processing and are not currently being executed by a worker.
 *
 * @param {string} userId Authenticated user identifier.
 * @param {string} jobId Job identifier.
 * @param {Date} [cancelledAt=new Date()] Cancellation timestamp.
 * @returns {Promise<object>} Updated cancelled job.
 * @throws {AppError} When the job does not exist or cannot be cancelled.
 */
export async function cancelJob(userId, jobId, cancelledAt = new Date()) {
  const existingJob = await findJobByIdForUser({
    userId,
    jobId,
  });

  if (!existingJob) {
    throw new AppError('Job was not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'JOB_NOT_FOUND',
    });
  }

  if (!CANCELLABLE_JOB_STATUSES.includes(existingJob.status)) {
    throw new AppError(
      `Job cannot be cancelled while in ${existingJob.status} status.`,
      HTTP_STATUS.CONFLICT,
      {
        code: 'JOB_NOT_CANCELLABLE',
        details: {
          currentStatus: existingJob.status,
          allowedStatuses: CANCELLABLE_JOB_STATUSES,
        },
      },
    );
  }

  const transition = await transitionJobStatus({
    userId,
    jobId,
    expectedStatuses: CANCELLABLE_JOB_STATUSES,
    status: 'CANCELLED',
    data: {
      cancelledAt,
      lockedAt: null,
      lockedByWorkerId: null,
    },
  });

  if (transition.count !== 1) {
    throw new AppError(
      'Job status changed before cancellation could be completed.',
      HTTP_STATUS.CONFLICT,
      {
        code: 'JOB_STATE_CONFLICT',
      },
    );
  }

  return findJobByIdForUser({
    userId,
    jobId,
  });
}
