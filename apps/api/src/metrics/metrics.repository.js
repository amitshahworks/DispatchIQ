/**
 * @file metrics.repository.js
 * @description Read-only Prisma data-access operations for DispatchIQ platform
 * metrics and operational monitoring.
 *
 * This repository exposes aggregate database queries used by the metrics
 * service to calculate queue health, worker availability, execution
 * performance, throughput, and reliability indicators.
 *
 * The repository intentionally returns raw database aggregates rather than
 * presentation-ready percentages or dashboard structures. Business-level
 * calculations such as success rate, failure rate, queue depth, and health
 * interpretation belong to the metrics service.
 */

import { prisma } from '@dispatchiq/database';

const STALE_WORKER_STATUSES = Object.freeze(['STARTING', 'ONLINE', 'BUSY']);

const CLAIMABLE_JOB_STATUSES = Object.freeze(['SCHEDULED', 'QUEUED', 'RETRYING']);

/**
 * Returns job counts grouped by lifecycle status.
 *
 * The service layer converts this raw grouped result into a stable object
 * containing every supported JobStatus, including statuses with a zero count.
 *
 * @returns {Promise<Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>>} Job counts grouped by status.
 */
export function countJobsByStatus() {
  return prisma.job.groupBy({
    by: ['status'],
    _count: {
      _all: true,
    },
  });
}

/**
 * Returns the total number of persisted jobs.
 *
 * This value is queried separately from grouped lifecycle counts so the
 * service does not need to depend on summing potentially partial group data.
 *
 * @returns {Promise<number>} Total number of jobs.
 */
export function countAllJobs() {
  return prisma.job.count();
}

/**
 * Returns worker-instance counts grouped by lifecycle status.
 *
 * Historical OFFLINE workers remain included because worker metrics expose
 * both currently active capacity and historical worker-instance state.
 *
 * @returns {Promise<Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>>} Worker counts grouped by status.
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
 * Returns the total number of persisted worker instances.
 *
 * @returns {Promise<number>} Total worker-instance count.
 */
export function countAllWorkers() {
  return prisma.workerInstance.count();
}

/**
 * Counts workers whose heartbeat has exceeded the supplied stale threshold.
 *
 * The same runtime-active states used by worker recovery are applied here so
 * monitoring and recovery agree about which worker instances may become
 * stale. UNHEALTHY and OFFLINE workers are intentionally excluded because
 * their failure state is already explicit.
 *
 * @param {{
 *   staleBefore: Date
 * }} input Stale-worker cutoff.
 * @returns {Promise<number>} Number of stale active workers.
 */
export function countStaleWorkers({ staleBefore }) {
  return prisma.workerInstance.count({
    where: {
      status: {
        in: STALE_WORKER_STATUSES,
      },
      lastHeartbeatAt: {
        lte: staleBefore,
      },
    },
  });
}

/**
 * Returns aggregate execution-attempt statistics.
 *
 * `durationMs` is nullable while an attempt is PROCESSING, so average
 * processing duration includes only attempts that have a persisted duration.
 * The total attempt count still includes every execution attempt regardless of
 * completion state.
 *
 * @returns {Promise<{
 *   _count: { _all: number },
 *   _avg: { durationMs: number | null }
 * }>} Execution-attempt aggregates.
 */
export function getAttemptMetrics() {
  return prisma.jobAttempt.aggregate({
    _count: {
      _all: true,
    },
    _avg: {
      durationMs: true,
    },
  });
}

/**
 * Returns the average number of execution attempts recorded per job.
 *
 * Job.attemptCount is incremented transactionally during each successful job
 * claim, making it suitable for aggregate retry/attempt analysis.
 *
 * @returns {Promise<{
 *   _avg: { attemptCount: number | null }
 * }>} Average attempt-count aggregate.
 */
export function getAverageAttemptsPerJob() {
  return prisma.job.aggregate({
    _avg: {
      attemptCount: true,
    },
  });
}

/**
 * Counts jobs created on or after a supplied timestamp.
 *
 * Used for throughput windows such as "created during the last hour" or
 * "created today". Time-window boundaries are calculated by the service layer
 * so this repository remains independent of timezone and reporting policy.
 *
 * @param {{
 *   since: Date
 * }} input Inclusive lower time boundary.
 * @returns {Promise<number>} Number of jobs created within the window.
 */
export function countJobsCreatedSince({ since }) {
  return prisma.job.count({
    where: {
      createdAt: {
        gte: since,
      },
    },
  });
}

/**
 * Counts jobs completed on or after a supplied timestamp.
 *
 * `completedAt` is used instead of `updatedAt` so unrelated lifecycle updates
 * cannot inflate completion throughput.
 *
 * @param {{
 *   since: Date
 * }} input Inclusive lower time boundary.
 * @returns {Promise<number>} Number of jobs completed within the window.
 */
export function countJobsCompletedSince({ since }) {
  return prisma.job.count({
    where: {
      status: 'COMPLETED',
      completedAt: {
        gte: since,
      },
    },
  });
}

/**
 * Counts execution attempts created on or after a supplied timestamp.
 *
 * This metric allows the service layer to derive recent execution volume and
 * compare job throughput with actual processing attempts.
 *
 * @param {{
 *   since: Date
 * }} input Inclusive lower time boundary.
 * @returns {Promise<number>} Number of attempts created within the window.
 */
export function countAttemptsCreatedSince({ since }) {
  return prisma.jobAttempt.count({
    where: {
      createdAt: {
        gte: since,
      },
    },
  });
}

/**
 * Returns execution-attempt counts grouped by attempt outcome.
 *
 * This provides the raw values required to calculate completion, failure, and
 * timeout rates without embedding percentage calculations in the repository.
 *
 * @returns {Promise<Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>>} Attempt counts grouped by status.
 */
export function countAttemptsByStatus() {
  return prisma.jobAttempt.groupBy({
    by: ['status'],
    _count: {
      _all: true,
    },
  });
}

/**
 * Finds the oldest job that is currently eligible to be claimed.
 *
 * Scheduled jobs whose availability time is still in the future are excluded.
 * PROCESSING jobs are also excluded because they are already owned by workers.
 * A missing result means no job is currently waiting for execution.
 *
 * The service can compare `availableAt` with the current time to calculate the
 * oldest ready-job age, which is a useful queue-latency health signal.
 *
 * @param {{
 *   asOf?: Date
 * }} [input] Current queue observation time.
 * @returns {Promise<{
 *   id: string,
 *   status: string,
 *   priority: string,
 *   availableAt: Date,
 *   createdAt: Date
 * } | null>} Oldest currently claimable job.
 */
export function findOldestClaimableJob({ asOf = new Date() } = {}) {
  return prisma.job.findFirst({
    where: {
      status: {
        in: CLAIMABLE_JOB_STATUSES,
      },
      availableAt: {
        lte: asOf,
      },
      lockedByWorkerId: null,
    },
    orderBy: [
      {
        availableAt: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
    select: {
      id: true,
      status: true,
      priority: true,
      availableAt: true,
      createdAt: true,
    },
  });
}

/**
 * Counts jobs that are immediately eligible for worker claiming.
 *
 * Unlike the broader pending-job count derived from lifecycle status totals,
 * this metric excludes future scheduled jobs and jobs delayed by retry
 * backoff.
 *
 * @param {{
 *   asOf?: Date
 * }} [input] Current queue observation time.
 * @returns {Promise<number>} Current claimable queue depth.
 */
export function countClaimableJobs({ asOf = new Date() } = {}) {
  return prisma.job.count({
    where: {
      status: {
        in: CLAIMABLE_JOB_STATUSES,
      },
      availableAt: {
        lte: asOf,
      },
      lockedByWorkerId: null,
    },
  });
}
