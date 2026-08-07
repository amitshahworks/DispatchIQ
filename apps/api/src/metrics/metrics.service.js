/**
 * @file metrics.service.js
 * @description Business logic for DispatchIQ platform metrics and operational
 * monitoring.
 *
 * The metrics repository returns raw PostgreSQL aggregates. This service
 * normalizes those aggregates into stable dashboard-facing structures and
 * derives queue health, worker availability, execution reliability, and
 * throughput metrics.
 *
 * Reporting calculations remain intentionally separated from persistence so
 * repository queries stay reusable and dashboard semantics can evolve without
 * changing the database-access layer.
 */

import {
  countAllJobs,
  countAllWorkers,
  countAttemptsByStatus,
  countAttemptsCreatedSince,
  countClaimableJobs,
  countJobsByStatus,
  countJobsCompletedSince,
  countJobsCreatedSince,
  countStaleWorkers,
  countWorkersByStatus,
  findOldestClaimableJob,
  getAttemptMetrics,
  getAverageAttemptsPerJob,
} from './metrics.repository.js';

const DEFAULT_STALE_AFTER_MS = 30_000;

const JOB_STATUSES = Object.freeze([
  'SCHEDULED',
  'QUEUED',
  'PROCESSING',
  'RETRYING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER',
  'CANCELLED',
]);

const WORKER_STATUSES = Object.freeze([
  'STARTING',
  'ONLINE',
  'BUSY',
  'UNHEALTHY',
  'OFFLINE',
  'STOPPING',
]);

const ATTEMPT_STATUSES = Object.freeze(['PROCESSING', 'COMPLETED', 'FAILED', 'TIMED_OUT']);

const ONE_HOUR_MS = 60 * 60 * 1_000;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

/**
 * Validates a Date value used as the metrics observation timestamp.
 *
 * @param {Date} value Date to validate.
 * @param {string} name Configuration name.
 * @returns {void}
 * @throws {Error} When the supplied value is not a valid Date.
 */
function assertValidDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} must be a valid Date.`);
  }
}

/**
 * Validates a positive integer configuration value.
 *
 * @param {number} value Configuration value.
 * @param {string} name Configuration name.
 * @returns {void}
 * @throws {Error} When the supplied value is invalid.
 */
function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

/**
 * Converts Prisma grouped count results into a stable status map.
 *
 * Missing statuses are explicitly represented as zero so API consumers do not
 * need to account for fields disappearing when no records currently exist in
 * a lifecycle state.
 *
 * @param {string[]} statuses Supported lifecycle statuses.
 * @param {Array<{
 *   status: string,
 *   _count: { _all: number }
 * }>} groups Prisma grouped counts.
 * @returns {Record<string, number>} Status-to-count mapping.
 */
function normalizeGroupedCounts(statuses, groups) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));

  for (const group of groups) {
    if (Object.prototype.hasOwnProperty.call(counts, group.status)) {
      counts[group.status] = group._count._all;
    }
  }

  return counts;
}

/**
 * Rounds a finite numeric metric to two decimal places.
 *
 * @param {number | null | undefined} value Numeric metric.
 * @param {number} [fallback=0] Value returned for missing/non-finite input.
 * @returns {number} Rounded metric.
 */
function roundMetric(value, fallback = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(value * 100) / 100;
}

/**
 * Calculates a percentage while safely handling an empty denominator.
 *
 * @param {number} numerator Metric numerator.
 * @param {number} denominator Metric denominator.
 * @returns {number} Percentage rounded to two decimals.
 */
function calculatePercentage(numerator, denominator) {
  if (denominator <= 0) {
    return 0;
  }

  return roundMetric((numerator / denominator) * 100);
}

/**
 * Calculates how long the oldest currently claimable job has been waiting.
 *
 * Queue age is based on `availableAt`, not `createdAt`, because scheduled and
 * retrying jobs should not be considered delayed before they become eligible
 * for execution.
 *
 * @param {{ availableAt?: Date } | null} job Oldest claimable job.
 * @param {Date} observationTime Current metrics timestamp.
 * @returns {number | null} Ready-queue age in milliseconds, or null when the
 * queue contains no claimable jobs.
 */
function calculateOldestClaimableAgeMs(job, observationTime) {
  if (!job) {
    return null;
  }

  if (!(job.availableAt instanceof Date)) {
    return null;
  }

  return Math.max(0, observationTime.getTime() - job.availableAt.getTime());
}

/**
 * Builds the DispatchIQ platform metrics snapshot.
 *
 * Time-based throughput uses rolling one-hour and rolling twenty-four-hour
 * windows instead of calendar-day boundaries. Rolling windows avoid implicit
 * timezone assumptions and provide deterministic operational monitoring
 * regardless of where the API server is deployed.
 *
 * Reliability percentages are based on completed execution attempts:
 *
 * - success rate: COMPLETED attempts / terminal attempts
 * - failure rate: FAILED attempts / terminal attempts
 * - timeout rate: TIMED_OUT attempts / terminal attempts
 *
 * PROCESSING attempts are intentionally excluded from those percentages
 * because their final outcome is not yet known.
 *
 * @param {{
 *   now?: Date,
 *   staleAfterMs?: number
 * }} [options] Metrics observation configuration.
 * @returns {Promise<{
 *   generatedAt: string,
 *   queue: object,
 *   workers: object,
 *   execution: object,
 *   throughput: object
 * }>} Dashboard-ready platform metrics.
 */
export async function getPlatformMetrics({
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  assertValidDate(now, 'now');
  assertPositiveInteger(staleAfterMs, 'staleAfterMs');

  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS);

  const twentyFourHoursAgo = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);

  const staleBefore = new Date(now.getTime() - staleAfterMs);

  /*
   * Metrics queries are independent read-only operations. Executing them in
   * parallel minimizes endpoint latency while preserving repository isolation.
   */
  const [
    totalJobs,
    jobsByStatusGroups,
    claimableJobs,
    oldestClaimableJob,

    totalWorkers,
    workersByStatusGroups,
    staleWorkers,

    attemptMetrics,
    attemptsByStatusGroups,
    averageAttempts,

    jobsCreatedLastHour,
    jobsCompletedLastHour,
    attemptsCreatedLastHour,

    jobsCreatedLast24Hours,
    jobsCompletedLast24Hours,
    attemptsCreatedLast24Hours,
  ] = await Promise.all([
    countAllJobs(),
    countJobsByStatus(),
    countClaimableJobs({
      asOf: now,
    }),
    findOldestClaimableJob({
      asOf: now,
    }),

    countAllWorkers(),
    countWorkersByStatus(),
    countStaleWorkers({
      staleBefore,
    }),

    getAttemptMetrics(),
    countAttemptsByStatus(),
    getAverageAttemptsPerJob(),

    countJobsCreatedSince({
      since: oneHourAgo,
    }),
    countJobsCompletedSince({
      since: oneHourAgo,
    }),
    countAttemptsCreatedSince({
      since: oneHourAgo,
    }),

    countJobsCreatedSince({
      since: twentyFourHoursAgo,
    }),
    countJobsCompletedSince({
      since: twentyFourHoursAgo,
    }),
    countAttemptsCreatedSince({
      since: twentyFourHoursAgo,
    }),
  ]);

  const jobsByStatus = normalizeGroupedCounts(JOB_STATUSES, jobsByStatusGroups);

  const workersByStatus = normalizeGroupedCounts(WORKER_STATUSES, workersByStatusGroups);

  const attemptsByStatus = normalizeGroupedCounts(ATTEMPT_STATUSES, attemptsByStatusGroups);

  const pendingJobs = jobsByStatus.SCHEDULED + jobsByStatus.QUEUED + jobsByStatus.RETRYING;

  const activeWorkers = workersByStatus.STARTING + workersByStatus.ONLINE + workersByStatus.BUSY;

  const terminalAttempts =
    attemptsByStatus.COMPLETED + attemptsByStatus.FAILED + attemptsByStatus.TIMED_OUT;

  return {
    generatedAt: now.toISOString(),

    queue: {
      total: totalJobs,

      scheduled: jobsByStatus.SCHEDULED,
      queued: jobsByStatus.QUEUED,
      processing: jobsByStatus.PROCESSING,
      retrying: jobsByStatus.RETRYING,
      completed: jobsByStatus.COMPLETED,
      failed: jobsByStatus.FAILED,
      deadLetter: jobsByStatus.DEAD_LETTER,
      cancelled: jobsByStatus.CANCELLED,

      /*
       * Pending includes all jobs waiting for future or immediate execution.
       * Claimable is narrower and contains only unlocked jobs eligible now.
       */
      pending: pendingJobs,
      claimable: claimableJobs,

      oldestClaimableJobAgeMs: calculateOldestClaimableAgeMs(oldestClaimableJob, now),
    },

    workers: {
      total: totalWorkers,

      starting: workersByStatus.STARTING,
      online: workersByStatus.ONLINE,
      busy: workersByStatus.BUSY,
      unhealthy: workersByStatus.UNHEALTHY,
      offline: workersByStatus.OFFLINE,
      stopping: workersByStatus.STOPPING,

      active: activeWorkers,
      available: workersByStatus.ONLINE,
      stale: staleWorkers,
    },

    execution: {
      totalAttempts: attemptMetrics._count._all,

      processing: attemptsByStatus.PROCESSING,

      completed: attemptsByStatus.COMPLETED,

      failed: attemptsByStatus.FAILED,

      timedOut: attemptsByStatus.TIMED_OUT,

      successRate: calculatePercentage(attemptsByStatus.COMPLETED, terminalAttempts),

      failureRate: calculatePercentage(attemptsByStatus.FAILED, terminalAttempts),

      timeoutRate: calculatePercentage(attemptsByStatus.TIMED_OUT, terminalAttempts),

      averageDurationMs: roundMetric(attemptMetrics._avg.durationMs),

      averageAttemptsPerJob: roundMetric(averageAttempts._avg.attemptCount),
    },

    throughput: {
      lastHour: {
        jobsCreated: jobsCreatedLastHour,
        jobsCompleted: jobsCompletedLastHour,
        attemptsCreated: attemptsCreatedLastHour,
      },

      last24Hours: {
        jobsCreated: jobsCreatedLast24Hours,
        jobsCompleted: jobsCompletedLast24Hours,
        attemptsCreated: attemptsCreatedLast24Hours,
      },
    },
  };
}
