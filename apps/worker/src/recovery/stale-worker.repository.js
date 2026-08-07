/**
 * @file stale-worker.repository.js
 * @description Transaction-safe persistence operations for recovering stale
 * DispatchIQ worker instances and jobs abandoned by failed worker processes.
 *
 * A worker is considered stale when its last persisted heartbeat is older than
 * a caller-provided cutoff while the worker remains in a runtime-active state.
 *
 * Recovery follows defensive concurrency rules:
 *
 * - stale detection does not mutate records;
 * - marking a worker UNHEALTHY re-checks its heartbeat timestamp atomically;
 * - abandoned jobs are recovered only while still PROCESSING and locked by the
 *   stale worker;
 * - active attempts are finalized as TIMED_OUT;
 * - job transition, attempt transition, and lifecycle logging occur inside one
 *   database transaction;
 * - worker locks are cleared only when recovery successfully transitions the
 *   abandoned job.
 *
 * Business decisions such as retry eligibility and retry-backoff calculation
 * belong to the stale-worker service rather than this repository.
 */

import { prisma } from '@dispatchiq/database';

const STALE_CANDIDATE_STATUSES = Object.freeze(['STARTING', 'ONLINE', 'BUSY']);

/**
 * Finds worker instances whose heartbeat is older than the supplied cutoff.
 *
 * STOPPING workers are intentionally excluded because graceful shutdown has
 * already begun and should be allowed to finish through its normal lifecycle.
 * UNHEALTHY and OFFLINE workers have already left the active-worker pool.
 *
 * Results are ordered by oldest heartbeat first so recovery prioritizes the
 * workers that have been unreachable for the longest period.
 *
 * @param {{
 *   staleBefore: Date,
 *   limit?: number
 * }} input Stale-worker lookup configuration.
 * @returns {Promise<object[]>} Stale worker candidates.
 */
export function findStaleWorkers({ staleBefore, limit = 100 }) {
  return prisma.workerInstance.findMany({
    where: {
      status: {
        in: STALE_CANDIDATE_STATUSES,
      },
      lastHeartbeatAt: {
        lte: staleBefore,
      },
    },
    orderBy: {
      lastHeartbeatAt: 'asc',
    },
    take: limit,
  });
}

/**
 * Atomically marks a stale active worker as UNHEALTHY.
 *
 * The heartbeat condition is repeated during the update to protect against a
 * race where the worker sends a new heartbeat after stale-worker discovery but
 * before recovery begins. In that situation the update count is zero and the
 * worker must not be recovered.
 *
 * @param {{
 *   workerId: string,
 *   staleBefore: Date
 * }} input Worker recovery guard.
 * @returns {Promise<{ count: number }>} Number of workers transitioned.
 */
export function markWorkerUnhealthy({ workerId, staleBefore }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: {
        in: STALE_CANDIDATE_STATUSES,
      },
      lastHeartbeatAt: {
        lte: staleBefore,
      },
    },
    data: {
      status: 'UNHEALTHY',
    },
  });
}

/**
 * Finds jobs still being processed under a stale worker lock.
 *
 * The currently active PROCESSING attempt is included because recovery must
 * finalize that execution as TIMED_OUT before the job can be retried or moved
 * to the dead-letter queue.
 *
 * Under normal execution there should be exactly one PROCESSING attempt per
 * claimed job. Ordering defensively selects the most recently started active
 * attempt if inconsistent historical data exists.
 *
 * @param {string} workerId Stale worker-instance identifier.
 * @returns {Promise<object[]>} Processing jobs still owned by the worker.
 */
export function findProcessingJobsLockedByWorker(workerId) {
  return prisma.job.findMany({
    where: {
      status: 'PROCESSING',
      lockedByWorkerId: workerId,
    },
    orderBy: {
      lockedAt: 'asc',
    },
    include: {
      attempts: {
        where: {
          workerInstanceId: workerId,
          status: 'PROCESSING',
        },
        orderBy: {
          startedAt: 'desc',
        },
        take: 1,
      },
    },
  });
}

/**
 * Recovers an abandoned job by scheduling another execution attempt.
 *
 * The job remains eligible for future claiming but is moved from PROCESSING to
 * RETRYING. Its stale worker lock is cleared and the interrupted JobAttempt is
 * finalized as TIMED_OUT.
 *
 * All mutations and lifecycle logging are committed atomically. A conditional
 * job transition ensures another recovery process or worker cannot recover the
 * same job twice.
 *
 * @param {{
 *   jobId: string,
 *   workerId: string,
 *   attemptId: string,
 *   retryAt: Date,
 *   recoveredAt?: Date,
 *   durationMs: number,
 *   errorMessage: string
 * }} input Abandoned-job retry recovery data.
 * @returns {Promise<object>} Recovered RETRYING job.
 * @throws {Error} When the stale worker no longer owns the processing job or
 * its active execution attempt cannot be finalized.
 */
export function recoverJobForRetry({
  jobId,
  workerId,
  attemptId,
  retryAt,
  recoveredAt = new Date(),
  durationMs,
  errorMessage,
}) {
  return prisma.$transaction(async (transaction) => {
    const jobTransition = await transaction.job.updateMany({
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

    if (jobTransition.count !== 1) {
      throw new Error(
        'Stale job retry recovery failed because the worker no longer owns the processing job.',
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
        status: 'TIMED_OUT',
        finishedAt: recoveredAt,
        durationMs,
        error: errorMessage,
      },
    });

    if (attemptTransition.count !== 1) {
      throw new Error(
        'Stale job retry recovery failed because the active processing attempt was not found.',
      );
    }

    await transaction.jobLog.create({
      data: {
        jobId,
        level: 'WARN',
        event: 'JOB_RETRYING',
        message: 'Job execution was interrupted by a stale worker and scheduled for retry.',
        metadata: {
          workerId,
          attemptId,
          retryAt: retryAt.toISOString(),
          recoveredAt: recoveredAt.toISOString(),
          durationMs,
          error: errorMessage,
          reason: 'STALE_WORKER',
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
 * Recovers an abandoned job whose maximum execution attempts are exhausted.
 *
 * The interrupted attempt is finalized as TIMED_OUT and the job transitions
 * directly to DEAD_LETTER. The stale lock is cleared so the dead-lettered job
 * no longer appears owned by an unavailable worker.
 *
 * @param {{
 *   jobId: string,
 *   workerId: string,
 *   attemptId: string,
 *   recoveredAt?: Date,
 *   durationMs: number,
 *   errorMessage: string
 * }} input Dead-letter recovery data.
 * @returns {Promise<object>} Recovered DEAD_LETTER job.
 * @throws {Error} When the stale worker no longer owns the processing job or
 * its active execution attempt cannot be finalized.
 */
export function recoverJobToDeadLetter({
  jobId,
  workerId,
  attemptId,
  recoveredAt = new Date(),
  durationMs,
  errorMessage,
}) {
  return prisma.$transaction(async (transaction) => {
    const jobTransition = await transaction.job.updateMany({
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

    if (jobTransition.count !== 1) {
      throw new Error(
        'Stale job dead-letter recovery failed because the worker no longer owns the processing job.',
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
        status: 'TIMED_OUT',
        finishedAt: recoveredAt,
        durationMs,
        error: errorMessage,
      },
    });

    if (attemptTransition.count !== 1) {
      throw new Error(
        'Stale job dead-letter recovery failed because the active processing attempt was not found.',
      );
    }

    await transaction.jobLog.create({
      data: {
        jobId,
        level: 'ERROR',
        event: 'JOB_DEAD_LETTERED',
        message:
          'Job execution was interrupted by a stale worker and no execution attempts remain.',
        metadata: {
          workerId,
          attemptId,
          recoveredAt: recoveredAt.toISOString(),
          durationMs,
          error: errorMessage,
          reason: 'STALE_WORKER',
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
 * Marks a recovered UNHEALTHY worker as OFFLINE.
 *
 * Unlike graceful shutdown, stale recovery deliberately does not update
 * `lastHeartbeatAt`. That field must preserve the worker's last real heartbeat
 * rather than falsely suggesting the crashed process remained alive until the
 * recovery timestamp.
 *
 * @param {{
 *   workerId: string,
 *   recoveredAt?: Date
 * }} input Worker finalization data.
 * @returns {Promise<{ count: number }>} Number of workers transitioned.
 */
export function markRecoveredWorkerOffline({ workerId, recoveredAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: 'UNHEALTHY',
    },
    data: {
      status: 'OFFLINE',
      stoppedAt: recoveredAt,
    },
  });
}
