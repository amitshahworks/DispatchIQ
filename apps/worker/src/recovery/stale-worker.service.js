/**
 * @file stale-worker.service.js
 * @description Business logic for detecting stale DispatchIQ worker instances
 * and recovering jobs abandoned by failed worker processes.
 *
 * The service coordinates stale-worker discovery, guarded lifecycle
 * transitions, abandoned-job recovery, retry scheduling, dead-letter
 * decisions, and final worker shutdown state.
 *
 * Database mutations remain isolated in stale-worker.repository.js. Retry
 * backoff uses the same policy as normal worker execution so crash recovery and
 * ordinary handler failures follow consistent scheduling rules.
 */

import { calculateRetryDelayMs } from '../jobs/job-processor.js';
import {
  findProcessingJobsLockedByWorker,
  findStaleWorkers as findStaleWorkerRecords,
  markRecoveredWorkerOffline,
  markWorkerUnhealthy,
  recoverJobForRetry,
  recoverJobToDeadLetter,
} from './stale-worker.repository.js';

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60 * 1_000;
const DEFAULT_STALE_WORKER_LIMIT = 100;

const STALE_WORKER_ERROR_MESSAGE =
  'Job execution timed out because the owning worker stopped sending heartbeats.';

/**
 * Creates a recovery-specific operational error.
 *
 * @param {string} message Human-readable recovery failure.
 * @returns {Error} Named recovery error.
 */
function createRecoveryError(message) {
  const error = new Error(message);

  error.name = 'StaleWorkerRecoveryError';

  return error;
}

/**
 * Validates a positive integer configuration value.
 *
 * @param {number} value Configuration value.
 * @param {string} name Configuration name.
 * @returns {void}
 * @throws {Error} When the value is not a positive integer.
 */
function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

/**
 * Calculates the elapsed execution time for an interrupted attempt.
 *
 * Negative durations are clamped to zero to protect persisted metrics from
 * system-clock adjustments.
 *
 * @param {Date} startedAt Attempt start timestamp.
 * @param {Date} recoveredAt Recovery timestamp.
 * @returns {number} Attempt duration in milliseconds.
 */
function calculateAttemptDurationMs(startedAt, recoveredAt) {
  return Math.max(0, recoveredAt.getTime() - startedAt.getTime());
}

/**
 * Creates the stale-worker recovery service.
 *
 * @param {{
 *   staleAfterMs?: number,
 *   retryBaseDelayMs?: number,
 *   retryMaxDelayMs?: number,
 *   staleWorkerLimit?: number,
 *   now?: () => Date
 * }} [options] Recovery policy configuration.
 * @returns {{
 *   findStaleWorkers: () => Promise<object[]>,
 *   recoverWorker: (workerId: string) => Promise<{
 *     workerId: string,
 *     workerRecovered: number,
 *     jobsRecovered: number,
 *     jobsRetried: number,
 *     jobsDeadLettered: number,
 *     skipped: boolean
 *   }>,
 *   recoverAllWorkers: () => Promise<{
 *     workersRecovered: number,
 *     jobsRecovered: number,
 *     jobsRetried: number,
 *     jobsDeadLettered: number,
 *     failures: Array<{
 *       workerId: string,
 *       error: string
 *     }>
 *   }>
 * }} Recovery service.
 */
export function createStaleWorkerRecoveryService({
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  staleWorkerLimit = DEFAULT_STALE_WORKER_LIMIT,
  now = () => new Date(),
} = {}) {
  assertPositiveInteger(staleAfterMs, 'staleAfterMs');

  assertPositiveInteger(retryBaseDelayMs, 'retryBaseDelayMs');

  assertPositiveInteger(retryMaxDelayMs, 'retryMaxDelayMs');

  assertPositiveInteger(staleWorkerLimit, 'staleWorkerLimit');

  if (retryMaxDelayMs < retryBaseDelayMs) {
    throw new Error('retryMaxDelayMs cannot be lower than retryBaseDelayMs.');
  }

  if (typeof now !== 'function') {
    throw new Error('Stale-worker recovery requires a now function.');
  }

  /**
   * Calculates the heartbeat cutoff used for stale-worker detection.
   *
   * @param {Date} referenceTime Current recovery timestamp.
   * @returns {Date} Oldest acceptable heartbeat timestamp.
   */
  function getStaleBefore(referenceTime) {
    return new Date(referenceTime.getTime() - staleAfterMs);
  }

  /**
   * Finds workers whose persisted heartbeat has exceeded the stale threshold.
   *
   * @returns {Promise<object[]>} Stale worker candidates.
   */
  async function findStaleWorkers() {
    const referenceTime = now();

    return findStaleWorkerRecords({
      staleBefore: getStaleBefore(referenceTime),
      limit: staleWorkerLimit,
    });
  }

  /**
   * Recovers one abandoned job from a stale worker.
   *
   * Retry eligibility is based on the already-incremented job attemptCount.
   * When attempts remain, the job transitions to RETRYING using the same
   * exponential backoff policy as normal worker failures. Exhausted jobs move
   * directly to DEAD_LETTER.
   *
   * @param {{
   *   job: object,
   *   workerId: string,
   *   recoveredAt: Date
   * }} input Recovery context.
   * @returns {Promise<'RETRIED' | 'DEAD_LETTERED'>} Recovery outcome.
   */
  async function recoverLockedJob({ job, workerId, recoveredAt }) {
    const activeAttempt = job.attempts?.[0];

    if (!activeAttempt) {
      throw createRecoveryError(
        `Cannot recover job ${job.id} because no active PROCESSING attempt was found.`,
      );
    }

    if (!(activeAttempt.startedAt instanceof Date)) {
      throw createRecoveryError(
        `Cannot recover job ${job.id} because its active attempt has an invalid startedAt timestamp.`,
      );
    }

    if (!Number.isInteger(job.attemptCount) || job.attemptCount < 1) {
      throw createRecoveryError(`Cannot recover job ${job.id} because attemptCount is invalid.`);
    }

    if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
      throw createRecoveryError(`Cannot recover job ${job.id} because maxAttempts is invalid.`);
    }

    const durationMs = calculateAttemptDurationMs(activeAttempt.startedAt, recoveredAt);

    const attemptsRemain = job.attemptCount < job.maxAttempts;

    if (!attemptsRemain) {
      await recoverJobToDeadLetter({
        jobId: job.id,
        workerId,
        attemptId: activeAttempt.id,
        recoveredAt,
        durationMs,
        errorMessage: STALE_WORKER_ERROR_MESSAGE,
      });

      return 'DEAD_LETTERED';
    }

    const retryDelayMs = calculateRetryDelayMs({
      attemptCount: job.attemptCount,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
    });

    const retryAt = new Date(recoveredAt.getTime() + retryDelayMs);

    await recoverJobForRetry({
      jobId: job.id,
      workerId,
      attemptId: activeAttempt.id,
      retryAt,
      recoveredAt,
      durationMs,
      errorMessage: STALE_WORKER_ERROR_MESSAGE,
    });

    return 'RETRIED';
  }

  /**
   * Recovers one worker that has exceeded the heartbeat timeout.
   *
   * The worker is first conditionally transitioned to UNHEALTHY. A zero-row
   * transition is treated as an expected concurrency race: the worker may have
   * sent a fresh heartbeat or changed state after stale discovery.
   *
   * The worker is marked OFFLINE only after every abandoned processing job has
   * been recovered successfully. A recovery failure intentionally leaves the
   * worker UNHEALTHY for investigation or a later recovery attempt.
   *
   * @param {string} workerId Worker-instance identifier.
   * @returns {Promise<{
   *   workerId: string,
   *   workerRecovered: number,
   *   jobsRecovered: number,
   *   jobsRetried: number,
   *   jobsDeadLettered: number,
   *   skipped: boolean
   * }>} Recovery summary.
   */
  async function recoverWorker(workerId) {
    if (typeof workerId !== 'string' || workerId.trim().length === 0) {
      throw new Error('recoverWorker requires a valid workerId.');
    }

    const normalizedWorkerId = workerId.trim();
    const recoveredAt = now();
    const staleBefore = getStaleBefore(recoveredAt);

    const unhealthyTransition = await markWorkerUnhealthy({
      workerId: normalizedWorkerId,
      staleBefore,
    });

    /*
     * This is normally a healthy concurrency race rather than an error.
     * Another recovery process may have claimed the worker, or the worker may
     * have refreshed its heartbeat after the initial stale-worker scan.
     */
    if (unhealthyTransition.count !== 1) {
      return {
        workerId: normalizedWorkerId,
        workerRecovered: 0,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        skipped: true,
      };
    }

    const lockedJobs = await findProcessingJobsLockedByWorker(normalizedWorkerId);

    let jobsRetried = 0;
    let jobsDeadLettered = 0;

    for (const job of lockedJobs) {
      const outcome = await recoverLockedJob({
        job,
        workerId: normalizedWorkerId,
        recoveredAt,
      });

      if (outcome === 'RETRIED') {
        jobsRetried += 1;
      } else {
        jobsDeadLettered += 1;
      }
    }

    const offlineTransition = await markRecoveredWorkerOffline({
      workerId: normalizedWorkerId,
      recoveredAt,
    });

    if (offlineTransition.count !== 1) {
      throw createRecoveryError(
        `Recovered worker ${normalizedWorkerId} could not transition from UNHEALTHY to OFFLINE.`,
      );
    }

    return {
      workerId: normalizedWorkerId,
      workerRecovered: 1,
      jobsRecovered: jobsRetried + jobsDeadLettered,
      jobsRetried,
      jobsDeadLettered,
      skipped: false,
    };
  }

  /**
   * Finds and recovers every stale worker in the current recovery batch.
   *
   * Worker recovery failures are isolated so one corrupt or concurrently
   * modified worker does not prevent recovery of other stale workers.
   *
   * Failures remain visible in the returned summary and affected workers stay
   * UNHEALTHY rather than being falsely marked OFFLINE.
   *
   * @returns {Promise<{
   *   workersRecovered: number,
   *   jobsRecovered: number,
   *   jobsRetried: number,
   *   jobsDeadLettered: number,
   *   failures: Array<{
   *     workerId: string,
   *     error: string
   *   }>
   * }>} Batch recovery statistics.
   */
  async function recoverAllWorkers() {
    const staleWorkers = await findStaleWorkers();

    const summary = {
      workersRecovered: 0,
      jobsRecovered: 0,
      jobsRetried: 0,
      jobsDeadLettered: 0,
      failures: [],
    };

    for (const worker of staleWorkers) {
      try {
        const result = await recoverWorker(worker.id);

        summary.workersRecovered += result.workerRecovered;

        summary.jobsRecovered += result.jobsRecovered;

        summary.jobsRetried += result.jobsRetried;

        summary.jobsDeadLettered += result.jobsDeadLettered;
      } catch (error) {
        summary.failures.push({
          workerId: worker.id,
          error: error instanceof Error ? error.message : 'Unknown stale-worker recovery failure.',
        });
      }
    }

    return summary;
  }

  return {
    findStaleWorkers,
    recoverWorker,
    recoverAllWorkers,
  };
}
