/**
 * @file stale-worker.service.test.js
 * @description Unit tests for DispatchIQ stale-worker recovery business logic.
 *
 * Repository operations are mocked so these tests focus on heartbeat cutoff
 * calculation, guarded recovery, retry/dead-letter decisions, abandoned
 * attempt duration, batch summaries, partial failures, and configuration
 * validation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findStaleWorkersMock = vi.fn();
const markWorkerUnhealthyMock = vi.fn();
const findProcessingJobsLockedByWorkerMock = vi.fn();
const recoverJobForRetryMock = vi.fn();
const recoverJobToDeadLetterMock = vi.fn();
const markRecoveredWorkerOfflineMock = vi.fn();

vi.mock('./stale-worker.repository.js', () => ({
  findStaleWorkers: findStaleWorkersMock,
  markWorkerUnhealthy: markWorkerUnhealthyMock,
  findProcessingJobsLockedByWorker: findProcessingJobsLockedByWorkerMock,
  recoverJobForRetry: recoverJobForRetryMock,
  recoverJobToDeadLetter: recoverJobToDeadLetterMock,
  markRecoveredWorkerOffline: markRecoveredWorkerOfflineMock,
}));

const { createStaleWorkerRecoveryService } = await import('./stale-worker.service.js');

const NOW = new Date('2026-08-07T10:00:00.000Z');

const STALE_ERROR = 'Job execution timed out because the owning worker stopped sending heartbeats.';

/**
 * Creates a valid abandoned processing job.
 *
 * @param {Partial<object>} overrides Job overrides.
 * @returns {object} Processing-job fixture.
 */
function createLockedJob(overrides = {}) {
  return {
    id: 'job-123',
    status: 'PROCESSING',
    attemptCount: 1,
    maxAttempts: 3,
    lockedByWorkerId: 'worker-123',
    attempts: [
      {
        id: 'attempt-123',
        status: 'PROCESSING',
        startedAt: new Date('2026-08-07T09:59:45.000Z'),
      },
    ],
    ...overrides,
  };
}

/**
 * Creates a deterministic recovery service.
 *
 * @param {object} overrides Configuration overrides.
 * @returns {ReturnType<typeof createStaleWorkerRecoveryService>}
 */
function createService(overrides = {}) {
  return createStaleWorkerRecoveryService({
    staleAfterMs: 30_000,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 60_000,
    staleWorkerLimit: 50,
    now: () => NOW,
    ...overrides,
  });
}

describe('stale-worker recovery service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findStaleWorkersMock.mockResolvedValue([]);

    markWorkerUnhealthyMock.mockResolvedValue({
      count: 1,
    });

    findProcessingJobsLockedByWorkerMock.mockResolvedValue([]);

    recoverJobForRetryMock.mockResolvedValue({
      id: 'job-123',
      status: 'RETRYING',
    });

    recoverJobToDeadLetterMock.mockResolvedValue({
      id: 'job-123',
      status: 'DEAD_LETTER',
    });

    markRecoveredWorkerOfflineMock.mockResolvedValue({
      count: 1,
    });
  });

  describe('findStaleWorkers', () => {
    it('calculates the stale heartbeat cutoff', async () => {
      const service = createService();

      await service.findStaleWorkers();

      expect(findStaleWorkersMock).toHaveBeenCalledWith({
        staleBefore: new Date('2026-08-07T09:59:30.000Z'),
        limit: 50,
      });
    });

    it('returns stale workers from the repository', async () => {
      const workers = [
        {
          id: 'worker-1',
        },
        {
          id: 'worker-2',
        },
      ];

      findStaleWorkersMock.mockResolvedValue(workers);

      const service = createService();

      await expect(service.findStaleWorkers()).resolves.toEqual(workers);
    });
  });

  describe('recoverWorker', () => {
    it('marks the worker UNHEALTHY before inspecting its jobs', async () => {
      const callOrder = [];

      markWorkerUnhealthyMock.mockImplementation(async () => {
        callOrder.push('unhealthy');

        return {
          count: 1,
        };
      });

      findProcessingJobsLockedByWorkerMock.mockImplementation(async () => {
        callOrder.push('jobs');

        return [];
      });

      const service = createService();

      await service.recoverWorker('worker-123');

      expect(callOrder).toEqual(['unhealthy', 'jobs']);
    });

    it('skips recovery when the stale guard no longer matches', async () => {
      markWorkerUnhealthyMock.mockResolvedValue({
        count: 0,
      });

      const service = createService();

      const result = await service.recoverWorker('worker-123');

      expect(result).toEqual({
        workerId: 'worker-123',
        workerRecovered: 0,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        skipped: true,
      });

      expect(findProcessingJobsLockedByWorkerMock).not.toHaveBeenCalled();

      expect(markRecoveredWorkerOfflineMock).not.toHaveBeenCalled();
    });

    it('recovers a stale worker with no abandoned jobs', async () => {
      const service = createService();

      const result = await service.recoverWorker('worker-123');

      expect(findProcessingJobsLockedByWorkerMock).toHaveBeenCalledWith('worker-123');

      expect(markRecoveredWorkerOfflineMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        recoveredAt: NOW,
      });

      expect(result).toEqual({
        workerId: 'worker-123',
        workerRecovered: 1,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        skipped: false,
      });
    });

    it('schedules an abandoned job for retry when attempts remain', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          attemptCount: 2,
          maxAttempts: 4,
        }),
      ]);

      const service = createService({
        retryBaseDelayMs: 1_000,
      });

      const result = await service.recoverWorker('worker-123');

      expect(recoverJobForRetryMock).toHaveBeenCalledWith({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        retryAt: new Date('2026-08-07T10:00:02.000Z'),
        recoveredAt: NOW,
        durationMs: 15_000,
        errorMessage: STALE_ERROR,
      });

      expect(recoverJobToDeadLetterMock).not.toHaveBeenCalled();

      expect(result.jobsRetried).toBe(1);
      expect(result.jobsRecovered).toBe(1);
    });

    it('caps recovery retry backoff at the configured maximum', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          attemptCount: 10,
          maxAttempts: 20,
        }),
      ]);

      const service = createService({
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 30_000,
      });

      await service.recoverWorker('worker-123');

      expect(recoverJobForRetryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAt: new Date('2026-08-07T10:00:30.000Z'),
        }),
      );
    });

    it('dead-letters an abandoned job when attempts are exhausted', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          attemptCount: 3,
          maxAttempts: 3,
        }),
      ]);

      const service = createService();

      const result = await service.recoverWorker('worker-123');

      expect(recoverJobToDeadLetterMock).toHaveBeenCalledWith({
        jobId: 'job-123',
        workerId: 'worker-123',
        attemptId: 'attempt-123',
        recoveredAt: NOW,
        durationMs: 15_000,
        errorMessage: STALE_ERROR,
      });

      expect(recoverJobForRetryMock).not.toHaveBeenCalled();

      expect(result.jobsDeadLettered).toBe(1);
      expect(result.jobsRecovered).toBe(1);
    });

    it('recovers multiple abandoned jobs and aggregates outcomes', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          id: 'job-retry',
          attemptCount: 1,
          maxAttempts: 3,
          attempts: [
            {
              id: 'attempt-retry',
              startedAt: new Date('2026-08-07T09:59:50.000Z'),
            },
          ],
        }),
        createLockedJob({
          id: 'job-dead',
          attemptCount: 3,
          maxAttempts: 3,
          attempts: [
            {
              id: 'attempt-dead',
              startedAt: new Date('2026-08-07T09:59:40.000Z'),
            },
          ],
        }),
      ]);

      const service = createService();

      const result = await service.recoverWorker('worker-123');

      expect(result).toMatchObject({
        workerRecovered: 1,
        jobsRecovered: 2,
        jobsRetried: 1,
        jobsDeadLettered: 1,
        skipped: false,
      });
    });

    it('clamps negative attempt duration to zero', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          attempts: [
            {
              id: 'attempt-123',
              startedAt: new Date('2026-08-07T10:00:05.000Z'),
            },
          ],
        }),
      ]);

      const service = createService();

      await service.recoverWorker('worker-123');

      expect(recoverJobForRetryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 0,
        }),
      );
    });

    it('fails when an abandoned job has no active attempt', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([
        createLockedJob({
          attempts: [],
        }),
      ]);

      const service = createService();

      await expect(service.recoverWorker('worker-123')).rejects.toMatchObject({
        name: 'StaleWorkerRecoveryError',
        message: 'Cannot recover job job-123 because no active PROCESSING attempt was found.',
      });

      expect(markRecoveredWorkerOfflineMock).not.toHaveBeenCalled();
    });

    it('leaves the worker UNHEALTHY when job recovery fails', async () => {
      findProcessingJobsLockedByWorkerMock.mockResolvedValue([createLockedJob()]);

      recoverJobForRetryMock.mockRejectedValue(new Error('Database unavailable.'));

      const service = createService();

      await expect(service.recoverWorker('worker-123')).rejects.toThrow('Database unavailable.');

      expect(markRecoveredWorkerOfflineMock).not.toHaveBeenCalled();
    });

    it('fails when the recovered worker cannot transition to OFFLINE', async () => {
      markRecoveredWorkerOfflineMock.mockResolvedValue({
        count: 0,
      });

      const service = createService();

      await expect(service.recoverWorker('worker-123')).rejects.toMatchObject({
        name: 'StaleWorkerRecoveryError',
        message: 'Recovered worker worker-123 could not transition from UNHEALTHY to OFFLINE.',
      });
    });

    it('rejects an invalid worker identifier', async () => {
      const service = createService();

      await expect(service.recoverWorker('   ')).rejects.toThrow(
        'recoverWorker requires a valid workerId.',
      );
    });
  });

  describe('recoverAllWorkers', () => {
    it('returns an empty summary when no stale workers exist', async () => {
      const service = createService();

      await expect(service.recoverAllWorkers()).resolves.toEqual({
        workersRecovered: 0,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        failures: [],
      });
    });

    it('aggregates recovery statistics across stale workers', async () => {
      findStaleWorkersMock.mockResolvedValue([
        {
          id: 'worker-1',
        },
        {
          id: 'worker-2',
        },
      ]);

      findProcessingJobsLockedByWorkerMock
        .mockResolvedValueOnce([
          createLockedJob({
            id: 'job-retry',
            lockedByWorkerId: 'worker-1',
          }),
        ])
        .mockResolvedValueOnce([
          createLockedJob({
            id: 'job-dead',
            attemptCount: 3,
            maxAttempts: 3,
            lockedByWorkerId: 'worker-2',
          }),
        ]);

      const service = createService();

      const result = await service.recoverAllWorkers();

      expect(result).toEqual({
        workersRecovered: 2,
        jobsRecovered: 2,
        jobsRetried: 1,
        jobsDeadLettered: 1,
        failures: [],
      });
    });

    it('continues recovering other workers after one worker fails', async () => {
      findStaleWorkersMock.mockResolvedValue([
        {
          id: 'worker-failed',
        },
        {
          id: 'worker-success',
        },
      ]);

      markWorkerUnhealthyMock
        .mockRejectedValueOnce(new Error('Recovery database failure.'))
        .mockResolvedValueOnce({
          count: 1,
        });

      const service = createService();

      const result = await service.recoverAllWorkers();

      expect(result).toEqual({
        workersRecovered: 1,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        failures: [
          {
            workerId: 'worker-failed',
            error: 'Recovery database failure.',
          },
        ],
      });

      expect(markWorkerUnhealthyMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('stale-worker recovery configuration', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects invalid stale timeout %s', (staleAfterMs) => {
    expect(() =>
      createStaleWorkerRecoveryService({
        staleAfterMs,
      }),
    ).toThrow('staleAfterMs must be a positive integer.');
  });

  it('rejects an invalid retry base delay', () => {
    expect(() =>
      createStaleWorkerRecoveryService({
        retryBaseDelayMs: 0,
      }),
    ).toThrow('retryBaseDelayMs must be a positive integer.');
  });

  it('rejects an invalid retry maximum delay', () => {
    expect(() =>
      createStaleWorkerRecoveryService({
        retryMaxDelayMs: 0,
      }),
    ).toThrow('retryMaxDelayMs must be a positive integer.');
  });

  it('rejects a retry maximum below the base delay', () => {
    expect(() =>
      createStaleWorkerRecoveryService({
        retryBaseDelayMs: 10_000,
        retryMaxDelayMs: 5_000,
      }),
    ).toThrow('retryMaxDelayMs cannot be lower than retryBaseDelayMs.');
  });

  it('rejects an invalid stale-worker batch limit', () => {
    expect(() =>
      createStaleWorkerRecoveryService({
        staleWorkerLimit: 0,
      }),
    ).toThrow('staleWorkerLimit must be a positive integer.');
  });

  it('rejects an invalid clock dependency', () => {
    expect(() =>
      createStaleWorkerRecoveryService({
        now: null,
      }),
    ).toThrow('Stale-worker recovery requires a now function.');
  });
});
