/**
 * @file worker.service.js
 * @description Business logic for DispatchIQ worker-management operations.
 *
 * The service converts raw worker-instance persistence data into stable API
 * structures used by operational dashboards and administrative clients.
 *
 * Responsibilities include:
 *
 * - pagination metadata;
 * - worker health interpretation;
 * - stale-heartbeat classification;
 * - lifecycle-status normalization;
 * - worker-detail shaping;
 * - cluster-level health summaries.
 *
 * Prisma access remains isolated in the repository layer.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';
import {
  countActiveWorkers,
  countStaleWorkers,
  countWorkers,
  countWorkersByStatus,
  findOldestActiveHeartbeat,
  findWorkerDetailsById,
  findWorkers,
} from './worker.repository.js';

const WORKER_STATUSES = Object.freeze([
  'STARTING',
  'ONLINE',
  'BUSY',
  'UNHEALTHY',
  'OFFLINE',
  'STOPPING',
]);

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_STALE_AFTER_MS = 60_000;

/**
 * Converts raw grouped worker counts into a stable lifecycle-count object.
 *
 * Every supported WorkerStatus is represented even when PostgreSQL returns no
 * row for that status.
 *
 * @param {Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>} groupedCounts Prisma worker-status groups.
 * @returns {Record<string, number>} Stable worker lifecycle counts.
 */
function normalizeStatusCounts(groupedCounts) {
  const counts = Object.fromEntries(WORKER_STATUSES.map((status) => [status, 0]));

  for (const group of groupedCounts) {
    if (Object.prototype.hasOwnProperty.call(counts, group.status)) {
      counts[group.status] = group._count._all;
    }
  }

  return counts;
}

/**
 * Calculates the age of a heartbeat relative to the supplied observation time.
 *
 * Future timestamps are defensively clamped to zero so clock skew cannot
 * produce negative heartbeat ages in API responses.
 *
 * @param {Date | null | undefined} heartbeatAt Last heartbeat timestamp.
 * @param {Date} asOf Observation timestamp.
 * @returns {number | null} Heartbeat age in milliseconds.
 */
function calculateHeartbeatAgeMs(heartbeatAt, asOf) {
  if (!(heartbeatAt instanceof Date)) {
    return null;
  }

  return Math.max(0, asOf.getTime() - heartbeatAt.getTime());
}

/**
 * Determines whether a worker heartbeat is stale at the supplied observation
 * time.
 *
 * Only runtime-active states are classified using heartbeat freshness.
 * Explicit UNHEALTHY, OFFLINE, and STOPPING states are already represented by
 * their lifecycle status and therefore are not reclassified as stale here.
 *
 * @param {{
 *   status: string,
 *   lastHeartbeatAt: Date
 * }} worker Worker record.
 * @param {Date} asOf Observation timestamp.
 * @param {number} staleAfterMs Allowed heartbeat age.
 * @returns {boolean} True when the active worker heartbeat is stale.
 */
function isWorkerStale(worker, asOf, staleAfterMs) {
  if (!['STARTING', 'ONLINE', 'BUSY'].includes(worker.status)) {
    return false;
  }

  const heartbeatAgeMs = calculateHeartbeatAgeMs(worker.lastHeartbeatAt, asOf);

  return heartbeatAgeMs !== null && heartbeatAgeMs >= staleAfterMs;
}

/**
 * Produces operational health metadata for one worker instance.
 *
 * @param {object} worker Worker persistence record.
 * @param {Date} asOf Observation timestamp.
 * @param {number} staleAfterMs Stale-heartbeat threshold.
 * @returns {{
 *   heartbeatAgeMs: number | null,
 *   isStale: boolean,
 *   health: 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'stopping'
 * }} Worker health information.
 */
function buildWorkerHealth(worker, asOf, staleAfterMs) {
  const heartbeatAgeMs = calculateHeartbeatAgeMs(worker.lastHeartbeatAt, asOf);

  const isStale = isWorkerStale(worker, asOf, staleAfterMs);

  if (worker.status === 'OFFLINE') {
    return {
      heartbeatAgeMs,
      isStale: false,
      health: 'offline',
    };
  }

  if (worker.status === 'STOPPING') {
    return {
      heartbeatAgeMs,
      isStale: false,
      health: 'stopping',
    };
  }

  if (worker.status === 'UNHEALTHY' || isStale) {
    return {
      heartbeatAgeMs,
      isStale,
      health: 'unhealthy',
    };
  }

  if (worker.status === 'STARTING') {
    return {
      heartbeatAgeMs,
      isStale: false,
      health: 'degraded',
    };
  }

  return {
    heartbeatAgeMs,
    isStale: false,
    health: 'healthy',
  };
}

/**
 * Returns a paginated collection of workers enriched with operational health.
 *
 * @param {{
 *   page?: number,
 *   limit?: number,
 *   status?: string
 * }} [query] Validated worker-list query.
 * @param {{
 *   asOf?: Date,
 *   staleAfterMs?: number
 * }} [options] Observation options.
 * @returns {Promise<{
 *   workers: Array<object>,
 *   pagination: {
 *     page: number,
 *     limit: number,
 *     total: number,
 *     totalPages: number
 *   }
 * }>} Paginated worker collection.
 */
export async function listWorkers(
  query = {},
  { asOf = new Date(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {},
) {
  const page = query.page ?? DEFAULT_PAGE;

  const limit = query.limit ?? DEFAULT_LIMIT;

  const skip = (page - 1) * limit;

  const [workers, total] = await Promise.all([
    findWorkers({
      skip,
      take: limit,
      status: query.status,
    }),

    countWorkers({
      status: query.status,
    }),
  ]);

  return {
    workers: workers.map((worker) => ({
      ...worker,

      health: buildWorkerHealth(worker, asOf, staleAfterMs),
    })),

    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

/**
 * Returns one worker with detailed operational context.
 *
 * @param {string} workerId Worker-instance identifier.
 * @param {{
 *   asOf?: Date,
 *   staleAfterMs?: number
 * }} [options] Observation options.
 * @returns {Promise<object>} Detailed worker response.
 * @throws {AppError} When the worker does not exist.
 */
export async function getWorker(
  workerId,
  { asOf = new Date(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {},
) {
  const worker = await findWorkerDetailsById(workerId);

  if (!worker) {
    throw new AppError('Worker was not found.', HTTP_STATUS.NOT_FOUND, {
      code: 'WORKER_NOT_FOUND',
    });
  }

  return {
    ...worker,

    health: buildWorkerHealth(worker, asOf, staleAfterMs),
  };
}

/**
 * Returns a cluster-level worker health summary.
 *
 * The cluster is interpreted as:
 *
 * - healthy   → at least one active worker and none are stale/unhealthy;
 * - degraded  → active capacity exists but stale/unhealthy workers are present;
 * - unavailable → no active workers exist.
 *
 * @param {{
 *   asOf?: Date,
 *   staleAfterMs?: number
 * }} [options] Health observation options.
 * @returns {Promise<object>} Worker-cluster health summary.
 */
export async function getWorkerHealth({
  asOf = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const staleBefore = new Date(asOf.getTime() - staleAfterMs);

  const [groupedCounts, activeWorkers, staleWorkers, oldestHeartbeat] = await Promise.all([
    countWorkersByStatus(),

    countActiveWorkers(),

    countStaleWorkers({
      staleBefore,
    }),

    findOldestActiveHeartbeat(),
  ]);

  const counts = normalizeStatusCounts(groupedCounts);

  const explicitlyUnhealthy = counts.UNHEALTHY;

  let health = 'healthy';

  if (activeWorkers === 0) {
    health = 'unavailable';
  } else if (staleWorkers > 0 || explicitlyUnhealthy > 0) {
    health = 'degraded';
  }

  return {
    health,

    asOf,

    staleAfterMs,

    workers: {
      active: activeWorkers,
      stale: staleWorkers,
      byStatus: counts,
    },

    oldestActiveHeartbeat: oldestHeartbeat
      ? {
          ...oldestHeartbeat,

          heartbeatAgeMs: calculateHeartbeatAgeMs(oldestHeartbeat.lastHeartbeatAt, asOf),
        }
      : null,
  };
}
