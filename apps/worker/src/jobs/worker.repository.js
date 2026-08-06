/**
 * @file worker.repository.js
 * @description Transaction-safe database operations used by DispatchIQ worker
 * processes to claim jobs and persist execution outcomes.
 *
 * Job claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`, allowing multiple
 * workers to poll concurrently without claiming the same job. All lifecycle
 * transitions also verify the current worker lock to prevent stale workers
 * from updating jobs they no longer own.
 */

import { prisma } from '@dispatchiq/database';

/**
 * Claims the next available job for a worker.
 *
 * Claim ordering:
 * 1. Highest priority first.
 * 2. Earliest availability time.
 * 3. Oldest creation time.
 *
 * The row is selected and locked inside one transaction. `SKIP LOCKED`
 * prevents concurrent workers from waiting on or selecting the same row.
 *
 * The transaction also:
 * - moves the job to PROCESSING;
 * - records the worker lock;
 * - increments attemptCount;
 * - creates a PROCESSING JobAttempt;
 * - creates a JOB_PROCESSING lifecycle log.
 *
 * @param {{
 *   workerId: string,
 *   claimedAt?: Date
 * }} input Claim context.
 * @returns {Promise<{
 *   job: object,
 *   attempt: object
 * } | null>} Claimed job and attempt, or null when no job is available.
 */
export function claimNextJob({ workerId, claimedAt = new Date() }) {
  return prisma.$transaction(async (transaction) => {
    const claimableJobs = await transaction.$queryRaw`
      SELECT "id"
      FROM "jobs"
      WHERE "status" IN ('SCHEDULED', 'QUEUED', 'RETRYING')
        AND "available_at" <= ${claimedAt}
        AND "locked_by_worker_id" IS NULL
      ORDER BY
        CASE "priority"
          WHEN 'HIGH' THEN 3
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 1
          ELSE 0
        END DESC,
        "available_at" ASC,
        "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const selectedJob = claimableJobs[0];

    if (!selectedJob) {
      return null;
    }

    const job = await transaction.job.update({
      where: {
        id: selectedJob.id,
      },
      data: {
        status: 'PROCESSING',
        lockedAt: claimedAt,
        lockedByWorkerId: workerId,
        attemptCount: {
          increment: 1,
        },
      },
    });

    const attempt = await transaction.jobAttempt.create({
      data: {
        jobId: job.id,
        attemptNumber: job.attemptCount,
        status: 'PROCESSING',
        workerInstanceId: workerId,
        startedAt: claimedAt,
      },
    });

    await transaction.jobLog.create({
      data: {
        jobId: job.id,
        level: 'INFO',
        event: 'JOB_PROCESSING',
        message: `Job claimed by worker ${workerId}.`,
        metadata: {
          workerId,
          attemptId: attempt.id,
          attemptNumber: attempt.attemptNumber,
        },
      },
    });

    return {
      job,
      attempt,
    };
  });
}

/**
 * Marks a worker-owned processing job as completed.
 *
 * The job update, attempt completion, and lifecycle log are committed
 * atomically. If the worker no longer owns the job, the entire transaction
 * fails and no partial execution result is persisted.
 *
 * @param {{
 *   jobId: string,
 *   workerId: string,
 *   attemptId: string,
 *   completedAt?: Date,
 *   durationMs: number
 * }} input Completion data.
 * @returns {Promise<object>} Completed job record.
 */
export function completeClaimedJob({
  jobId,
  workerId,
  attemptId,
  completedAt = new Date(),
  durationMs,
}) {
  return prisma.$transaction(async (transaction) => {
    const transition = await transaction.job.updateMany({
      where: {
        id: jobId,
        status: 'PROCESSING',
        lockedByWorkerId: workerId,
      },
      data: {
        status: 'COMPLETED',
        completedAt,
        lockedAt: null,
        lockedByWorkerId: null,
        lastError: null,
      },
    });

    if (transition.count !== 1) {
      throw new Error('Job completion failed because the worker no longer owns the active job.');
    }

    const attemptTransition = await transaction.jobAttempt.updateMany({
      where: {
        id: attemptId,
        jobId,
        workerInstanceId: workerId,
        status: 'PROCESSING',
      },
      data: {
        status: 'COMPLETED',
        finishedAt: completedAt,
        durationMs,
        error: null,
      },
    });

    if (attemptTransition.count !== 1) {
      throw new Error('Job attempt completion failed because the active attempt was not found.');
    }

    await transaction.jobLog.create({
      data: {
        jobId,
        level: 'INFO',
        event: 'JOB_COMPLETED',
        message: 'Job completed successfully.',
        metadata: {
          workerId,
          attemptId,
          durationMs,
        },
      },
    });

    return transaction.job.findUnique({
      where: {
        id: jobId,
      },
    });
  });
}

/**
 * Releases a failed job for a future retry.
 *
 * The job is moved to RETRYING and its worker lock is cleared. The associated
 * execution attempt is marked FAILED and the next availability timestamp
 * represents the retry backoff calculated by the worker service.
 *
 * @param {{
 *   jobId: string,
 *   workerId: string,
 *   attemptId: string,
 *   errorMessage: string,
 *   retryAt: Date,
 *   failedAt?: Date,
 *   durationMs: number
 * }} input Retry transition data.
 * @returns {Promise<object>} Retrying job record.
 */
export function releaseJobForRetry({
  jobId,
  workerId,
  attemptId,
  errorMessage,
  retryAt,
  failedAt = new Date(),
  durationMs,
}) {
  return prisma.$transaction(async (transaction) => {
    const transition = await transaction.job.updateMany({
      where: {
        id: jobId,
        status: 'PROCESSING',
        lockedByWorkerId: workerId,
      },
      data: {
        status: 'RETRYING',
        availableAt: retryAt,
        lastError: errorMessage,
        lockedAt: null,
        lockedByWorkerId: null,
      },
    });

    if (transition.count !== 1) {
      throw new Error(
        'Job retry scheduling failed because the worker no longer owns the active job.',
      );
    }

    const attemptTransition = await transaction.jobAttempt.updateMany({
      where: {
        id: attemptId,
        jobId,
        workerInstanceId: workerId,
        status: 'PROCESSING',
      },
      data: {
        status: 'FAILED',
        finishedAt: failedAt,
        durationMs,
        error: errorMessage,
      },
    });

    if (attemptTransition.count !== 1) {
      throw new Error(
        'Job attempt failure could not be recorded because the active attempt was not found.',
      );
    }

    await transaction.jobLog.create({
      data: {
        jobId,
        level: 'WARN',
        event: 'JOB_RETRYING',
        message: 'Job execution failed and was scheduled for retry.',
        metadata: {
          workerId,
          attemptId,
          retryAt: retryAt.toISOString(),
          error: errorMessage,
        },
      },
    });

    return transaction.job.findUnique({
      where: {
        id: jobId,
      },
    });
  });
}

/**
 * Moves an exhausted job to the dead-letter state.
 *
 * This transition is used when the failed attempt has consumed the job's
 * configured maximum number of attempts.
 *
 * @param {{
 *   jobId: string,
 *   workerId: string,
 *   attemptId: string,
 *   errorMessage: string,
 *   failedAt?: Date,
 *   durationMs: number
 * }} input Dead-letter transition data.
 * @returns {Promise<object>} Dead-lettered job record.
 */
export function moveJobToDeadLetter({
  jobId,
  workerId,
  attemptId,
  errorMessage,
  failedAt = new Date(),
  durationMs,
}) {
  return prisma.$transaction(async (transaction) => {
    const transition = await transaction.job.updateMany({
      where: {
        id: jobId,
        status: 'PROCESSING',
        lockedByWorkerId: workerId,
      },
      data: {
        status: 'DEAD_LETTER',
        lastError: errorMessage,
        lockedAt: null,
        lockedByWorkerId: null,
      },
    });

    if (transition.count !== 1) {
      throw new Error(
        'Dead-letter transition failed because the worker no longer owns the active job.',
      );
    }

    const attemptTransition = await transaction.jobAttempt.updateMany({
      where: {
        id: attemptId,
        jobId,
        workerInstanceId: workerId,
        status: 'PROCESSING',
      },
      data: {
        status: 'FAILED',
        finishedAt: failedAt,
        durationMs,
        error: errorMessage,
      },
    });

    if (attemptTransition.count !== 1) {
      throw new Error(
        'Job attempt failure could not be recorded because the active attempt was not found.',
      );
    }

    await transaction.jobLog.create({
      data: {
        jobId,
        level: 'ERROR',
        event: 'JOB_DEAD_LETTERED',
        message: 'Job exhausted its configured attempts and was moved to the dead-letter queue.',
        metadata: {
          workerId,
          attemptId,
          error: errorMessage,
        },
      },
    });

    return transaction.job.findUnique({
      where: {
        id: jobId,
      },
    });
  });
}
