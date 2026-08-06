/**
 * @file job-processor.js
 * @description Executes claimed DispatchIQ jobs and persists their final
 * lifecycle outcome.
 *
 * The processor selects the appropriate job handler, measures execution
 * duration, records successful completion, schedules retryable failures with
 * exponential backoff, and moves exhausted jobs to the dead-letter queue.
 *
 * Job-specific side effects remain isolated in handler functions. Database
 * lifecycle transitions remain isolated in the worker repository.
 */

import {
  completeClaimedJob,
  moveJobToDeadLetter,
  releaseJobForRetry,
} from './worker.repository.js';

const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60 * 1_000;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Normalizes an unknown thrown value into a safe persisted error message.
 *
 * Database records should contain useful diagnostic information without
 * storing excessively large values or relying on callers to throw Error
 * instances consistently.
 *
 * @param {unknown} error Unknown handler failure.
 * @returns {string} Safe error message.
 */
export function normalizeExecutionError(error) {
  let message;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = 'Job execution failed with an unknown error.';
  }

  const normalizedMessage = message.trim();

  if (normalizedMessage.length === 0) {
    return 'Job execution failed with an unknown error.';
  }

  return normalizedMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

/**
 * Calculates exponential retry backoff for a failed execution attempt.
 *
 * The current attempt count is one-based because claiming a job increments
 * `attemptCount` before execution begins:
 *
 * - attempt 1 failure → base delay
 * - attempt 2 failure → base delay × 2
 * - attempt 3 failure → base delay × 4
 *
 * The delay is capped to prevent retries from growing without limit.
 *
 * @param {{
 *   attemptCount: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number
 * }} input Retry calculation values.
 * @returns {number} Delay in milliseconds.
 */
export function calculateRetryDelayMs({
  attemptCount,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
}) {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error('Retry calculation requires a positive attemptCount.');
  }

  if (!Number.isInteger(baseDelayMs) || baseDelayMs <= 0) {
    throw new Error('Retry baseDelayMs must be a positive integer.');
  }

  if (!Number.isInteger(maxDelayMs) || maxDelayMs <= 0) {
    throw new Error('Retry maxDelayMs must be a positive integer.');
  }

  if (maxDelayMs < baseDelayMs) {
    throw new Error('Retry maxDelayMs cannot be lower than baseDelayMs.');
  }

  const exponentialDelay = baseDelayMs * 2 ** (attemptCount - 1);

  return Math.min(exponentialDelay, maxDelayMs);
}

/**
 * Creates a processor for claimed jobs.
 *
 * A handler must exist for every job type the worker is expected to execute.
 * Handlers receive the persisted job and may return any value; only successful
 * completion or thrown failure affects the lifecycle transition.
 *
 * @param {{
 *   workerId: string,
 *   handlers: Record<string, (job: object) => Promise<unknown>>,
 *   retryBaseDelayMs?: number,
 *   retryMaxDelayMs?: number,
 *   now?: () => Date
 * }} options Job-processor configuration.
 * @returns {(claim: {
 *   job: {
 *     id: string,
 *     type: string,
 *     attemptCount: number,
 *     maxAttempts: number
 *   },
 *   attempt: {
 *     id: string
 *   }
 * }) => Promise<void>} Claimed-job processor.
 */
export function createJobProcessor({
  workerId,
  handlers,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  now = () => new Date(),
}) {
  if (typeof workerId !== 'string' || workerId.trim().length === 0) {
    throw new Error('Job processor requires a valid workerId.');
  }

  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new Error('Job processor requires a handlers object.');
  }

  calculateRetryDelayMs({
    attemptCount: 1,
    baseDelayMs: retryBaseDelayMs,
    maxDelayMs: retryMaxDelayMs,
  });

  /**
   * Executes one claimed job and persists its outcome.
   *
   * @param {{
   *   job: {
   *     id: string,
   *     type: string,
   *     attemptCount: number,
   *     maxAttempts: number
   *   },
   *   attempt: {
   *     id: string
   *   }
   * }} claim Claimed job and active execution attempt.
   * @returns {Promise<void>}
   */
  return async function processClaim(claim) {
    if (!claim?.job || !claim?.attempt) {
      throw new Error('Job processor requires a claimed job and attempt.');
    }

    const { job, attempt } = claim;
    const handler = handlers[job.type];

    if (typeof handler !== 'function') {
      throw new Error(`No worker handler is registered for job type "${job.type}".`);
    }

    if (!Number.isInteger(job.attemptCount) || job.attemptCount < 1) {
      throw new Error('Claimed job contains an invalid attemptCount.');
    }

    if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1) {
      throw new Error('Claimed job contains an invalid maxAttempts.');
    }

    const startedAt = now();

    try {
      await handler(job);

      const completedAt = now();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

      await completeClaimedJob({
        jobId: job.id,
        workerId,
        attemptId: attempt.id,
        completedAt,
        durationMs,
      });
    } catch (error) {
      const failedAt = now();
      const durationMs = Math.max(0, failedAt.getTime() - startedAt.getTime());

      const errorMessage = normalizeExecutionError(error);
      const attemptsRemain = job.attemptCount < job.maxAttempts;

      if (!attemptsRemain) {
        await moveJobToDeadLetter({
          jobId: job.id,
          workerId,
          attemptId: attempt.id,
          errorMessage,
          failedAt,
          durationMs,
        });

        return;
      }

      const retryDelayMs = calculateRetryDelayMs({
        attemptCount: job.attemptCount,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: retryMaxDelayMs,
      });

      const retryAt = new Date(failedAt.getTime() + retryDelayMs);

      await releaseJobForRetry({
        jobId: job.id,
        workerId,
        attemptId: attempt.id,
        errorMessage,
        retryAt,
        failedAt,
        durationMs,
      });
    }
  };
}
