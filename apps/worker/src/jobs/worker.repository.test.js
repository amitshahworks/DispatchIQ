/**
 * @file worker.repository.test.js
 * @description Unit tests for transaction-safe DispatchIQ worker database
 * operations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionMock = vi.fn();

const queryRawMock = vi.fn();
const jobUpdateMock = vi.fn();
const jobUpdateManyMock = vi.fn();
const jobFindUniqueMock = vi.fn();
const attemptCreateMock = vi.fn();
const attemptUpdateManyMock = vi.fn();
const logCreateMock = vi.fn();

const transactionClient = {
  $queryRaw: queryRawMock,
  job: {
    update: jobUpdateMock,
    updateMany: jobUpdateManyMock,
    findUnique: jobFindUniqueMock,
  },
  jobAttempt: {
    create: attemptCreateMock,
    updateMany: attemptUpdateManyMock,
  },
  jobLog: {
    create: logCreateMock,
  },
};

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

const { claimNextJob, completeClaimedJob, moveJobToDeadLetter, releaseJobForRetry } =
  await import('./worker.repository.js');

describe('worker repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    transactionMock.mockImplementation((callback) => callback(transactionClient));
  });

  describe('claimNextJob', () => {
    it('returns null when no job is currently available', async () => {
      queryRawMock.mockResolvedValue([]);

      const result = await claimNextJob({
        workerId: 'worker-123',
        claimedAt: new Date('2026-08-06T10:00:00.000Z'),
      });

      expect(result).toBeNull();
      expect(jobUpdateMock).not.toHaveBeenCalled();
      expect(attemptCreateMock).not.toHaveBeenCalled();
      expect(logCreateMock).not.toHaveBeenCalled();
    });

    it('claims a job and creates an execution attempt atomically', async () => {
      const claimedAt = new Date('2026-08-06T10:00:00.000Z');

      queryRawMock.mockResolvedValue([
        {
          id: 'job-123',
        },
      ]);

      const job = {
        id: 'job-123',
        status: 'PROCESSING',
        attemptCount: 2,
        lockedByWorkerId: 'worker-123',
      };

      const attempt = {
        id: 'attempt-123',
        jobId: job.id,
        attemptNumber: 2,
        status: 'PROCESSING',
      };

      jobUpdateMock.mockResolvedValue(job);
      attemptCreateMock.mockResolvedValue(attempt);
      logCreateMock.mockResolvedValue({
        id: 'log-123',
      });

      const result = await claimNextJob({
        workerId: 'worker-123',
        claimedAt,
      });

      expect(jobUpdateMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
        },
        data: {
          status: 'PROCESSING',
          lockedAt: claimedAt,
          lockedByWorkerId: 'worker-123',
          attemptCount: {
            increment: 1,
          },
        },
      });

      expect(attemptCreateMock).toHaveBeenCalledWith({
        data: {
          jobId: job.id,
          attemptNumber: 2,
          status: 'PROCESSING',
          workerInstanceId: 'worker-123',
          startedAt: claimedAt,
        },
      });

      expect(logCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobId: job.id,
          level: 'INFO',
          event: 'JOB_PROCESSING',
        }),
      });

      expect(result).toEqual({
        job,
        attempt,
      });
    });
  });

  describe('completeClaimedJob', () => {
    it('completes a worker-owned job and its attempt', async () => {
      const completedAt = new Date('2026-08-06T10:01:00.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      jobFindUniqueMock.mockResolvedValue({
        id: 'job-123',
        status: 'COMPLETED',
      });

      const result = await completeClaimedJob({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        completedAt,
        durationMs: 60_000,
      });

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        data: {
          status: 'COMPLETED',
          completedAt,
          lockedAt: null,
          lockedByWorkerId: null,
          lastError: null,
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
          status: 'COMPLETED',
          finishedAt: completedAt,
          durationMs: 60_000,
          error: null,
        },
      });

      expect(logCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'JOB_COMPLETED',
          level: 'INFO',
        }),
      });

      expect(result).toMatchObject({
        status: 'COMPLETED',
      });
    });

    it('rejects completion when the worker no longer owns the job', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        completeClaimedJob({
          jobId: 'job-123',
          workerId: 'stale-worker',
          attemptId: 'attempt-123',
          durationMs: 100,
        }),
      ).rejects.toThrow('Job completion failed because the worker no longer owns the active job.');

      expect(attemptUpdateManyMock).not.toHaveBeenCalled();
      expect(logCreateMock).not.toHaveBeenCalled();
    });

    it('rejects completion when the active attempt is missing', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        completeClaimedJob({
          jobId: 'job-123',
          workerId: 'worker-123',
          attemptId: 'missing-attempt',
          durationMs: 100,
        }),
      ).rejects.toThrow('Job attempt completion failed because the active attempt was not found.');

      expect(logCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('releaseJobForRetry', () => {
    it('releases a failed job for a future retry', async () => {
      const failedAt = new Date('2026-08-06T10:01:00.000Z');

      const retryAt = new Date('2026-08-06T10:02:00.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      jobFindUniqueMock.mockResolvedValue({
        id: 'job-123',
        status: 'RETRYING',
      });

      const result = await releaseJobForRetry({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        errorMessage: 'Temporary webhook failure.',
        retryAt,
        failedAt,
        durationMs: 60_000,
      });

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        data: {
          status: 'RETRYING',
          availableAt: retryAt,
          lastError: 'Temporary webhook failure.',
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
          status: 'FAILED',
          finishedAt: failedAt,
          durationMs: 60_000,
          error: 'Temporary webhook failure.',
        },
      });

      expect(logCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'JOB_RETRYING',
          level: 'WARN',
        }),
      });

      expect(result).toMatchObject({
        status: 'RETRYING',
      });
    });

    it('rejects retry scheduling when the worker lock is stale', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        releaseJobForRetry({
          jobId: 'job-123',
          workerId: 'stale-worker',
          attemptId: 'attempt-123',
          errorMessage: 'Failure',
          retryAt: new Date(),
          durationMs: 100,
        }),
      ).rejects.toThrow(
        'Job retry scheduling failed because the worker no longer owns the active job.',
      );

      expect(attemptUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  describe('moveJobToDeadLetter', () => {
    it('moves an exhausted job to the dead-letter queue', async () => {
      const failedAt = new Date('2026-08-06T10:01:00.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      attemptUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      jobFindUniqueMock.mockResolvedValue({
        id: 'job-123',
        status: 'DEAD_LETTER',
      });

      const result = await moveJobToDeadLetter({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        errorMessage: 'Maximum attempts exhausted.',
        failedAt,
        durationMs: 60_000,
      });

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          status: 'PROCESSING',
          lockedByWorkerId: 'worker-123',
        },
        data: {
          status: 'DEAD_LETTER',
          lastError: 'Maximum attempts exhausted.',
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
          status: 'FAILED',
          finishedAt: failedAt,
          durationMs: 60_000,
          error: 'Maximum attempts exhausted.',
        },
      });

      expect(logCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          event: 'JOB_DEAD_LETTERED',
          level: 'ERROR',
        }),
      });

      expect(result).toMatchObject({
        status: 'DEAD_LETTER',
      });
    });

    it('rejects dead-lettering when the worker no longer owns the job', async () => {
      jobUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        moveJobToDeadLetter({
          jobId: 'job-123',
          workerId: 'stale-worker',
          attemptId: 'attempt-123',
          errorMessage: 'Failure',
          durationMs: 100,
        }),
      ).rejects.toThrow(
        'Dead-letter transition failed because the worker no longer owns the active job.',
      );

      expect(attemptUpdateManyMock).not.toHaveBeenCalled();
    });
  });
});
