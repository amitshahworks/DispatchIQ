/**
 * @file stale-worker.repository.test.js
 * @description Unit tests for DispatchIQ stale-worker recovery persistence.
 *
 * Prisma is mocked so these tests verify stale-worker discovery, guarded
 * lifecycle transitions, abandoned-job recovery transactions, attempt timeout
 * persistence, lifecycle logging, and worker finalization without requiring a
 * running PostgreSQL database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerFindManyMock = vi.fn();
const workerUpdateManyMock = vi.fn();

const jobFindManyMock = vi.fn();
const jobUpdateManyMock = vi.fn();
const jobFindUniqueMock = vi.fn();

const attemptUpdateManyMock = vi.fn();
const jobLogCreateMock = vi.fn();

const transactionMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    workerInstance: {
      findMany: workerFindManyMock,
      updateMany: workerUpdateManyMock,
    },
    job: {
      findMany: jobFindManyMock,
    },
    $transaction: transactionMock,
  },
}));

const {
  findProcessingJobsLockedByWorker,
  findStaleWorkers,
  markRecoveredWorkerOffline,
  markWorkerUnhealthy,
  recoverJobForRetry,
  recoverJobToDeadLetter,
} = await import('./stale-worker.repository.js');

/**
 * Configures the mocked Prisma transaction client.
 *
 * @returns {object} Transaction client used by repository callbacks.
 */
function createTransactionClient() {
  return {
    job: {
      updateMany: jobUpdateManyMock,
      findUnique: jobFindUniqueMock,
    },
    jobAttempt: {
      updateMany: attemptUpdateManyMock,
    },
    jobLog: {
      create: jobLogCreateMock,
    },
  };
}

describe('stale-worker repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    transactionMock.mockImplementation(async (callback) => callback(createTransactionClient()));
  });

  describe('findStaleWorkers', () => {
    it('finds active workers with heartbeats older than the stale cutoff', async () => {
      const staleBefore = new Date('2026-08-07T09:00:00.000Z');

      const workers = [
        {
          id: 'worker-1',
          status: 'ONLINE',
          lastHeartbeatAt: new Date('2026-08-07T08:55:00.000Z'),
        },
      ];

      workerFindManyMock.mockResolvedValue(workers);

      const result = await findStaleWorkers({
        staleBefore,
        limit: 25,
      });

      expect(workerFindManyMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY'],
          },
          lastHeartbeatAt: {
            lte: staleBefore,
          },
        },
        orderBy: {
          lastHeartbeatAt: 'asc',
        },
        take: 25,
      });

      expect(result).toEqual(workers);
    });

    it('uses the default lookup limit when none is provided', async () => {
      const staleBefore = new Date('2026-08-07T09:00:00.000Z');

      workerFindManyMock.mockResolvedValue([]);

      await findStaleWorkers({
        staleBefore,
      });

      expect(workerFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });
  });

  describe('markWorkerUnhealthy', () => {
    it('guards the transition using status and heartbeat cutoff', async () => {
      const staleBefore = new Date('2026-08-07T09:00:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await markWorkerUnhealthy({
        workerId: 'worker-123',
        staleBefore,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY'],
          },
          lastHeartbeatAt: {
            lte: staleBefore,
          },
        },
        data: {
          status: 'UNHEALTHY',
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });
  });

  describe('findProcessingJobsLockedByWorker', () => {
    it('finds processing jobs and their active attempt for the stale worker', async () => {
      const jobs = [
        {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
          attempts: [
            {
              id: 'attempt-123',
              status: 'PROCESSING',
            },
          ],
        },
      ];

      jobFindManyMock.mockResolvedValue(jobs);

      const result = await findProcessingJobsLockedByWorker('worker-123');

      expect(jobFindManyMock).toHaveBeenCalledWith({
        where: {
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        orderBy: {
          lockedAt: 'asc',
        },
        include: {
          attempts: {
            where: {
              workerInstanceId: 'worker-123',
              status: 'PROCESSING',
            },
            orderBy: {
              startedAt: 'desc',
            },
            take: 1,
          },
        },
      });

      expect(result).toEqual(jobs);
    });
  });

  describe('recoverJobForRetry', () => {
    it('atomically times out the attempt and schedules the job for retry', async () => {
      const recoveredAt = new Date('2026-08-07T09:10:00.000Z');
      const retryAt = new Date('2026-08-07T09:10:30.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      jobLogCreateMock.mockResolvedValue({
        id: 'log-123',
      });

      const recoveredJob = {
        id: 'job-123',
        status: 'RETRYING',
      };

      jobFindUniqueMock.mockResolvedValue(recoveredJob);

      const result = await recoverJobForRetry({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        retryAt,
        recoveredAt,
        durationMs: 15_000,
        errorMessage: 'Worker heartbeat expired.',
      });

      expect(transactionMock).toHaveBeenCalledOnce();

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        data: {
          status: 'RETRYING',
          availableAt: retryAt,
          lastError: 'Worker heartbeat expired.',
          lockedAt: null,
          lockedByWorkerId: null,
        },
      });

      expect(attemptUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'attempt-123',
          jobId: 'job-123',
          workerInstanceId: 'worker-123',
          status: 'PROCESSING',
        },
        data: {
          status: 'TIMED_OUT',
          finishedAt: recoveredAt,
          durationMs: 15_000,
          error: 'Worker heartbeat expired.',
        },
      });

      expect(jobLogCreateMock).toHaveBeenCalledWith({
        data: {
          jobId: 'job-123',
          level: 'WARN',
          event: 'JOB_RETRYING',
          message: 'Job execution was interrupted by a stale worker and scheduled for retry.',
          metadata: {
            workerId: 'worker-123',
            attemptId: 'attempt-123',
            retryAt: retryAt.toISOString(),
            recoveredAt: recoveredAt.toISOString(),
            durationMs: 15_000,
            error: 'Worker heartbeat expired.',
            reason: 'STALE_WORKER',
          },
        },
      });

      expect(jobFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
        },
      });

      expect(result).toEqual(recoveredJob);
    });

    it('fails when the stale worker no longer owns the job', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        recoverJobForRetry({
          jobId: 'job-123',
          workerId: 'worker-123',
          attemptId: 'attempt-123',
          retryAt: new Date('2026-08-07T09:10:30.000Z'),
          recoveredAt: new Date('2026-08-07T09:10:00.000Z'),
          durationMs: 15_000,
          errorMessage: 'Worker heartbeat expired.',
        }),
      ).rejects.toThrow(
        'Stale job retry recovery failed because the worker no longer owns the processing job.',
      );

      expect(attemptUpdateManyMock).not.toHaveBeenCalled();
      expect(jobLogCreateMock).not.toHaveBeenCalled();
    });

    it('fails when the processing attempt cannot be finalized', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        recoverJobForRetry({
          jobId: 'job-123',
          workerId: 'worker-123',
          attemptId: 'attempt-123',
          retryAt: new Date('2026-08-07T09:10:30.000Z'),
          recoveredAt: new Date('2026-08-07T09:10:00.000Z'),
          durationMs: 15_000,
          errorMessage: 'Worker heartbeat expired.',
        }),
      ).rejects.toThrow(
        'Stale job retry recovery failed because the active processing attempt was not found.',
      );

      expect(jobLogCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('recoverJobToDeadLetter', () => {
    it('atomically times out the attempt and dead-letters the job', async () => {
      const recoveredAt = new Date('2026-08-07T09:20:00.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      jobLogCreateMock.mockResolvedValue({
        id: 'log-123',
      });

      const recoveredJob = {
        id: 'job-123',
        status: 'DEAD_LETTER',
      };

      jobFindUniqueMock.mockResolvedValue(recoveredJob);

      const result = await recoverJobToDeadLetter({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        recoveredAt,
        durationMs: 30_000,
        errorMessage: 'Worker heartbeat expired.',
      });

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        data: {
          status: 'DEAD_LETTER',
          lastError: 'Worker heartbeat expired.',
          lockedAt: null,
          lockedByWorkerId: null,
        },
      });

      expect(attemptUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'attempt-123',
          jobId: 'job-123',
          workerInstanceId: 'worker-123',
          status: 'PROCESSING',
        },
        data: {
          status: 'TIMED_OUT',
          finishedAt: recoveredAt,
          durationMs: 30_000,
          error: 'Worker heartbeat expired.',
        },
      });

      expect(jobLogCreateMock).toHaveBeenCalledWith({
        data: {
          jobId: 'job-123',
          level: 'ERROR',
          event: 'JOB_DEAD_LETTERED',
          message:
            'Job execution was interrupted by a stale worker and no execution attempts remain.',
          metadata: {
            workerId: 'worker-123',
            attemptId: 'attempt-123',
            recoveredAt: recoveredAt.toISOString(),
            durationMs: 30_000,
            error: 'Worker heartbeat expired.',
            reason: 'STALE_WORKER',
          },
        },
      });

      expect(result).toEqual(recoveredJob);
    });

    it('fails when the stale worker no longer owns the job', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        recoverJobToDeadLetter({
          jobId: 'job-123',
          workerId: 'worker-123',
          attemptId: 'attempt-123',
          recoveredAt: new Date('2026-08-07T09:20:00.000Z'),
          durationMs: 30_000,
          errorMessage: 'Worker heartbeat expired.',
        }),
      ).rejects.toThrow(
        'Stale job dead-letter recovery failed because the worker no longer owns the processing job.',
      );

      expect(attemptUpdateManyMock).not.toHaveBeenCalled();
      expect(jobLogCreateMock).not.toHaveBeenCalled();
    });

    it('fails when the active attempt cannot be finalized', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        recoverJobToDeadLetter({
          jobId: 'job-123',
          workerId: 'worker-123',
          attemptId: 'attempt-123',
          recoveredAt: new Date('2026-08-07T09:20:00.000Z'),
          durationMs: 30_000,
          errorMessage: 'Worker heartbeat expired.',
        }),
      ).rejects.toThrow(
        'Stale job dead-letter recovery failed because the active processing attempt was not found.',
      );

      expect(jobLogCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('markRecoveredWorkerOffline', () => {
    it('marks only an UNHEALTHY worker as OFFLINE', async () => {
      const recoveredAt = new Date('2026-08-07T09:30:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await markRecoveredWorkerOffline({
        workerId: 'worker-123',
        recoveredAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: 'UNHEALTHY',
        },
        data: {
          status: 'OFFLINE',
          stoppedAt: recoveredAt,
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });

    it('does not overwrite the last heartbeat during recovery', async () => {
      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await markRecoveredWorkerOffline({
        workerId: 'worker-123',
        recoveredAt: new Date('2026-08-07T09:30:00.000Z'),
      });

      const update = workerUpdateManyMock.mock.calls[0][0].data;

      expect(update).not.toHaveProperty('lastHeartbeatAt');
    });
  });
});
