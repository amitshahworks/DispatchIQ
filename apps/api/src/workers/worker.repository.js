/**
 * @file worker.repository.js
 * @description Read-only Prisma data-access operations for DispatchIQ worker
 * management and operational inspection.
 *
 * This repository exposes worker-instance records to the API without owning
 * worker lifecycle transitions. Registration, heartbeat updates, status
 * transitions, graceful shutdown, and stale-worker recovery remain
 * responsibilities of the worker runtime and recovery modules.
 *
 * The repository returns raw persistence data and aggregate counts. Health
 * interpretation, stale-worker classification, pagination metadata, and API
 * response shaping belong to the worker service layer.
 */

import { prisma } from '@dispatchiq/database';

const ACTIVE_WORKER_STATUSES = Object.freeze(['STARTING', 'ONLINE', 'BUSY']);

/**
 * Returns a paginated collection of worker instances.
 *
 * Each worker includes aggregate counts for currently locked jobs and
 * historical execution attempts. The query may optionally be filtered by
 * WorkerStatus.
 *
 * Worker records are ordered newest first by startup time so recently
 * registered processes appear first in operational dashboards.
 *
 * @param {{
 *   skip: number,
 *   take: number,
 *   status?: string
 * }} query Worker listing query.
 * @returns {Promise<Array<object>>} Matching worker instances.
 */
export function findWorkers({ skip, take, status }) {
  return prisma.workerInstance.findMany({
    where: {
      ...(status ? { status } : {}),
    },

    orderBy: {
      startedAt: 'desc',
    },

    skip,
    take,

    include: {
      _count: {
        select: {
          lockedJobs: true,
          jobAttempts: true,
        },
      },
    },
  });
}

/**
 * Counts worker instances matching an optional lifecycle-status filter.
 *
 * Used together with `findWorkers` to construct pagination metadata in the
 * service layer.
 *
 * @param {{
 *   status?: string
 * }} [query] Optional worker filtering criteria.
 * @returns {Promise<number>} Number of matching worker instances.
 */
export function countWorkers({ status } = {}) {
  return prisma.workerInstance.count({
    where: {
      ...(status ? { status } : {}),
    },
  });
}

/**
 * Finds one worker instance with operational execution context.
 *
 * The detail query includes:
 *
 * - count of jobs currently locked by the worker;
 * - count of historical execution attempts;
 * - currently locked jobs with minimal operational metadata;
 * - recent execution attempts ordered newest first.
 *
 * The repository intentionally limits attempt history so a long-running worker
 * cannot produce an unbounded API response.
 *
 * @param {string} workerId Worker-instance identifier.
 * @returns {Promise<object | null>} Detailed worker record or null.
 */
export function findWorkerDetailsById(workerId) {
  return prisma.workerInstance.findUnique({
    where: {
      id: workerId,
    },

    include: {
      _count: {
        select: {
          lockedJobs: true,
          jobAttempts: true,
        },
      },

      lockedJobs: {
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          priority: true,
          attemptCount: true,
          maxAttempts: true,
          availableAt: true,
          lockedAt: true,
          createdAt: true,
        },

        orderBy: {
          lockedAt: 'asc',
        },
      },

      jobAttempts: {
        select: {
          id: true,
          jobId: true,
          attemptNumber: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          error: true,
        },

        orderBy: {
          startedAt: 'desc',
        },

        take: 25,
      },
    },
  });
}

/**
 * Returns worker-instance counts grouped by lifecycle status.
 *
 * The worker service converts this raw grouped result into a stable health
 * structure containing every supported WorkerStatus, including statuses whose
 * persisted count is currently zero.
 *
 * @returns {Promise<Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>>} Worker counts grouped by lifecycle status.
 */
export function countWorkersByStatus() {
  return prisma.workerInstance.groupBy({
    by: ['status'],

    _count: {
      _all: true,
    },
  });
}

/**
 * Counts currently active worker processes.
 *
 * STARTING, ONLINE, and BUSY match the active states used by DispatchIQ's
 * existing stale-worker metrics and recovery semantics.
 *
 * UNHEALTHY, STOPPING, and OFFLINE workers are excluded because they no longer
 * represent normally available processing capacity.
 *
 * @returns {Promise<number>} Number of active worker instances.
 */
export function countActiveWorkers() {
  return prisma.workerInstance.count({
    where: {
      status: {
        in: ACTIVE_WORKER_STATUSES,
      },
    },
  });
}

/**
 * Counts active workers whose heartbeat has exceeded a stale threshold.
 *
 * This deliberately uses the same active worker states already used by
 * DispatchIQ metrics and recovery logic so the Worker Management API does not
 * introduce a competing definition of worker staleness.
 *
 * @param {{
 *   staleBefore: Date
 * }} input Inclusive stale-heartbeat cutoff.
 * @returns {Promise<number>} Number of stale active worker instances.
 */
export function countStaleWorkers({ staleBefore }) {
  return prisma.workerInstance.count({
    where: {
      status: {
        in: ACTIVE_WORKER_STATUSES,
      },

      lastHeartbeatAt: {
        lte: staleBefore,
      },
    },
  });
}

/**
 * Finds the oldest heartbeat among currently active workers.
 *
 * This allows the service layer to expose cluster-level heartbeat age without
 * embedding time calculations in the repository.
 *
 * A null result means no active worker currently exists.
 *
 * @returns {Promise<{
 *   id: string,
 *   hostname: string,
 *   status: string,
 *   lastHeartbeatAt: Date
 * } | null>} Active worker with the oldest heartbeat.
 */
export function findOldestActiveHeartbeat() {
  return prisma.workerInstance.findFirst({
    where: {
      status: {
        in: ACTIVE_WORKER_STATUSES,
      },
    },

    orderBy: {
      lastHeartbeatAt: 'asc',
    },

    select: {
      id: true,
      hostname: true,
      status: true,
      lastHeartbeatAt: true,
    },
  });
}
