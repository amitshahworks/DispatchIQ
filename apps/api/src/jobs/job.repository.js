/**
 * @file job.repository.js
 * @description Prisma data-access layer for DispatchIQ job management.
 *
 * This repository contains database operations only. It does not validate HTTP
 * requests, enforce business rules, authorize users, calculate pagination
 * metadata, or decide whether a job lifecycle transition is permitted.
 *
 * User-scoped queries always include `userId` to prevent one user from reading
 * or modifying another user's jobs.
 */

import { prisma } from '@dispatchiq/database';

/**
 * Creates a new job owned by a user.
 *
 * The service layer determines the initial status and availability timestamp
 * before calling this repository function.
 *
 * @param {{
 *   userId: string,
 *   type: string,
 *   status: string,
 *   priority: string,
 *   payload: Record<string, unknown>,
 *   idempotencyKey?: string,
 *   maxAttempts: number,
 *   availableAt: Date
 * }} data Persisted job values.
 * @returns {Promise<object>} Created job record.
 */
export function createJob({
  userId,
  type,
  status,
  priority,
  payload,
  idempotencyKey,
  maxAttempts,
  availableAt,
}) {
  return prisma.job.create({
    data: {
      userId,
      type,
      status,
      priority,
      payload,
      idempotencyKey,
      maxAttempts,
      availableAt,
    },
  });
}

/**
 * Finds a job by its per-user idempotency key.
 *
 * The database has a compound unique constraint on `userId` and
 * `idempotencyKey`, so the same key may safely be reused by different users
 * while remaining unique for one user's submissions.
 *
 * @param {{ userId: string, idempotencyKey: string }} criteria Lookup values.
 * @returns {Promise<object | null>} Matching job or null.
 */
export function findJobByIdempotencyKey({ userId, idempotencyKey }) {
  return prisma.job.findUnique({
    where: {
      userId_idempotencyKey: {
        userId,
        idempotencyKey,
      },
    },
  });
}

/**
 * Finds one user-owned job by ID.
 *
 * Both the job ID and user ID are applied in the query to enforce ownership at
 * the database-access boundary and prevent insecure direct object references.
 *
 * @param {{ jobId: string, userId: string }} criteria Lookup values.
 * @returns {Promise<object | null>} Matching user-owned job or null.
 */
export function findJobByIdForUser({ jobId, userId }) {
  return prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
    },
  });
}

/**
 * Finds one user-owned job with its execution attempts and lifecycle logs.
 *
 * Attempts and logs are returned in chronological order for a deterministic
 * job-detail timeline.
 *
 * @param {{ jobId: string, userId: string }} criteria Lookup values.
 * @returns {Promise<object | null>} Detailed job record or null.
 */
export function findJobDetailsByIdForUser({ jobId, userId }) {
  return prisma.job.findFirst({
    where: {
      id: jobId,
      userId,
    },
    include: {
      attempts: {
        orderBy: {
          attemptNumber: 'asc',
        },
      },
      logs: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
}

/**
 * Returns a paginated collection of jobs owned by one user.
 *
 * Filtering values are expected to have already been validated and normalized
 * by the route-validation layer.
 *
 * @param {{
 *   userId: string,
 *   skip: number,
 *   take: number,
 *   status?: string,
 *   type?: string
 * }} query User-scoped listing query.
 * @returns {Promise<object[]>} Matching jobs ordered newest first.
 */
export function findJobsForUser({ userId, skip, take, status, type }) {
  return prisma.job.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: {
      createdAt: 'desc',
    },
    skip,
    take,
  });
}

/**
 * Counts jobs matching a user-scoped filter.
 *
 * Used with `findJobsForUser` to generate pagination metadata in the service
 * layer.
 *
 * @param {{
 *   userId: string,
 *   status?: string,
 *   type?: string
 * }} query User-scoped count query.
 * @returns {Promise<number>} Number of matching jobs.
 */
export function countJobsForUser({ userId, status, type }) {
  return prisma.job.count({
    where: {
      userId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
  });
}

/**
 * Atomically changes a user-owned job from one of the expected statuses to a
 * new status.
 *
 * `updateMany` is intentionally used so the current status can be checked in
 * the same database statement. A count of zero means the job did not exist,
 * did not belong to the user, or was no longer in an expected lifecycle state.
 *
 * @param {{
 *   jobId: string,
 *   userId: string,
 *   expectedStatuses: string[],
 *   status: string,
 *   data?: Record<string, unknown>
 * }} transition Lifecycle transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned jobs.
 */
export function transitionJobStatus({ jobId, userId, expectedStatuses, status, data = {} }) {
  return prisma.job.updateMany({
    where: {
      id: jobId,
      userId,
      status: {
        in: expectedStatuses,
      },
    },
    data: {
      ...data,
      status,
    },
  });
}
