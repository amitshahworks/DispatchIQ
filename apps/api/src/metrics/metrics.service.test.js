/**
 * @file metrics.service.test.js
 * @description Unit tests for DispatchIQ platform metrics business logic.
 *
 * Repository operations are mocked so these tests focus on normalization,
 * derived queue and worker metrics, execution reliability calculations,
 * rolling throughput windows, stale-worker thresholds, and input validation
 * without requiring PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const countAllJobsMock = vi.fn();
const countJobsByStatusMock = vi.fn();
const countClaimableJobsMock = vi.fn();
const findOldestClaimableJobMock = vi.fn();

const countAllWorkersMock = vi.fn();
const countWorkersByStatusMock = vi.fn();
const countStaleWorkersMock = vi.fn();

const getAttemptMetricsMock = vi.fn();
const countAttemptsByStatusMock = vi.fn();
const getAverageAttemptsPerJobMock = vi.fn();

const countJobsCreatedSinceMock = vi.fn();
const countJobsCompletedSinceMock = vi.fn();
const countAttemptsCreatedSinceMock = vi.fn();

vi.mock('./metrics.repository.js', () => ({
  countAllJobs: countAllJobsMock,
  countJobsByStatus: countJobsByStatusMock,
  countClaimableJobs: countClaimableJobsMock,
  findOldestClaimableJob: findOldestClaimableJobMock,

  countAllWorkers: countAllWorkersMock,
  countWorkersByStatus: countWorkersByStatusMock,
  countStaleWorkers: countStaleWorkersMock,

  getAttemptMetrics: getAttemptMetricsMock,
  countAttemptsByStatus: countAttemptsByStatusMock,
  getAverageAttemptsPerJob: getAverageAttemptsPerJobMock,

  countJobsCreatedSince: countJobsCreatedSinceMock,
  countJobsCompletedSince: countJobsCompletedSinceMock,
  countAttemptsCreatedSince: countAttemptsCreatedSinceMock,
}));

const { getPlatformMetrics } = await import('./metrics.service.js');

const NOW = new Date('2026-08-07T10:00:00.000Z');

/**
 * Configures repository mocks with an empty but valid metrics snapshot.
 *
 * Individual tests override only the values relevant to the behavior being
 * verified, keeping fixtures small and deterministic.
 *
 * @returns {void}
 */
function mockEmptyMetrics() {
  countAllJobsMock.mockResolvedValue(0);
  countJobsByStatusMock.mockResolvedValue([]);
  countClaimableJobsMock.mockResolvedValue(0);
  findOldestClaimableJobMock.mockResolvedValue(null);

  countAllWorkersMock.mockResolvedValue(0);
  countWorkersByStatusMock.mockResolvedValue([]);
  countStaleWorkersMock.mockResolvedValue(0);

  getAttemptMetricsMock.mockResolvedValue({
    _count: {
      _all: 0,
    },
    _avg: {
      durationMs: null,
    },
  });

  countAttemptsByStatusMock.mockResolvedValue([]);

  getAverageAttemptsPerJobMock.mockResolvedValue({
    _avg: {
      attemptCount: null,
    },
  });

  countJobsCreatedSinceMock.mockResolvedValue(0);
  countJobsCompletedSinceMock.mockResolvedValue(0);
  countAttemptsCreatedSinceMock.mockResolvedValue(0);
}

describe('metrics service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmptyMetrics();
  });

  describe('empty platform metrics', () => {
    it('returns a stable zero-value dashboard structure when no data exists', async () => {
      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result).toEqual({
        generatedAt: '2026-08-07T10:00:00.000Z',

        queue: {
          total: 0,
          scheduled: 0,
          queued: 0,
          processing: 0,
          retrying: 0,
          completed: 0,
          failed: 0,
          deadLetter: 0,
          cancelled: 0,
          pending: 0,
          claimable: 0,
          oldestClaimableJobAgeMs: null,
        },

        workers: {
          total: 0,
          starting: 0,
          online: 0,
          busy: 0,
          unhealthy: 0,
          offline: 0,
          stopping: 0,
          active: 0,
          available: 0,
          stale: 0,
        },

        execution: {
          totalAttempts: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          timedOut: 0,
          successRate: 0,
          failureRate: 0,
          timeoutRate: 0,
          averageDurationMs: 0,
          averageAttemptsPerJob: 0,
        },

        throughput: {
          lastHour: {
            jobsCreated: 0,
            jobsCompleted: 0,
            attemptsCreated: 0,
          },

          last24Hours: {
            jobsCreated: 0,
            jobsCompleted: 0,
            attemptsCreated: 0,
          },
        },
      });
    });
  });

  describe('queue metrics', () => {
    it('normalizes grouped job statuses and derives pending queue size', async () => {
      countAllJobsMock.mockResolvedValue(21);

      countJobsByStatusMock.mockResolvedValue([
        {
          status: 'SCHEDULED',
          _count: {
            _all: 2,
          },
        },
        {
          status: 'QUEUED',
          _count: {
            _all: 5,
          },
        },
        {
          status: 'PROCESSING',
          _count: {
            _all: 3,
          },
        },
        {
          status: 'RETRYING',
          _count: {
            _all: 2,
          },
        },
        {
          status: 'COMPLETED',
          _count: {
            _all: 7,
          },
        },
        {
          status: 'DEAD_LETTER',
          _count: {
            _all: 1,
          },
        },
        {
          status: 'CANCELLED',
          _count: {
            _all: 1,
          },
        },
      ]);

      countClaimableJobsMock.mockResolvedValue(6);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.queue).toEqual({
        total: 21,
        scheduled: 2,
        queued: 5,
        processing: 3,
        retrying: 2,
        completed: 7,
        failed: 0,
        deadLetter: 1,
        cancelled: 1,
        pending: 9,
        claimable: 6,
        oldestClaimableJobAgeMs: null,
      });
    });

    it('keeps missing lifecycle statuses at zero', async () => {
      countJobsByStatusMock.mockResolvedValue([
        {
          status: 'COMPLETED',
          _count: {
            _all: 4,
          },
        },
      ]);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.queue).toMatchObject({
        scheduled: 0,
        queued: 0,
        processing: 0,
        retrying: 0,
        completed: 4,
        failed: 0,
        deadLetter: 0,
        cancelled: 0,
      });
    });

    it('calculates the oldest claimable job age from availableAt', async () => {
      findOldestClaimableJobMock.mockResolvedValue({
        id: 'job-123',
        status: 'QUEUED',
        priority: 'HIGH',
        availableAt: new Date('2026-08-07T09:55:00.000Z'),
        createdAt: new Date('2026-08-07T09:50:00.000Z'),
      });

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.queue.oldestClaimableJobAgeMs).toBe(300_000);
    });

    it('clamps oldest claimable job age to zero when clocks move backwards', async () => {
      findOldestClaimableJobMock.mockResolvedValue({
        id: 'job-123',
        status: 'QUEUED',
        priority: 'HIGH',
        availableAt: new Date('2026-08-07T10:00:05.000Z'),
        createdAt: new Date('2026-08-07T09:50:00.000Z'),
      });

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.queue.oldestClaimableJobAgeMs).toBe(0);
    });

    it('returns null queue age when the oldest job has an invalid availability timestamp', async () => {
      findOldestClaimableJobMock.mockResolvedValue({
        id: 'job-123',
        availableAt: null,
      });

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.queue.oldestClaimableJobAgeMs).toBeNull();
    });

    it('passes the observation time to claimable queue queries', async () => {
      await getPlatformMetrics({
        now: NOW,
      });

      expect(countClaimableJobsMock).toHaveBeenCalledWith({
        asOf: NOW,
      });

      expect(findOldestClaimableJobMock).toHaveBeenCalledWith({
        asOf: NOW,
      });
    });
  });

  describe('worker metrics', () => {
    it('normalizes worker states and derives active and available capacity', async () => {
      countAllWorkersMock.mockResolvedValue(9);

      countWorkersByStatusMock.mockResolvedValue([
        {
          status: 'STARTING',
          _count: {
            _all: 1,
          },
        },
        {
          status: 'ONLINE',
          _count: {
            _all: 3,
          },
        },
        {
          status: 'BUSY',
          _count: {
            _all: 2,
          },
        },
        {
          status: 'UNHEALTHY',
          _count: {
            _all: 1,
          },
        },
        {
          status: 'OFFLINE',
          _count: {
            _all: 1,
          },
        },
        {
          status: 'STOPPING',
          _count: {
            _all: 1,
          },
        },
      ]);

      countStaleWorkersMock.mockResolvedValue(2);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.workers).toEqual({
        total: 9,
        starting: 1,
        online: 3,
        busy: 2,
        unhealthy: 1,
        offline: 1,
        stopping: 1,
        active: 6,
        available: 3,
        stale: 2,
      });
    });

    it('calculates the stale-worker cutoff from the configured threshold', async () => {
      await getPlatformMetrics({
        now: NOW,
        staleAfterMs: 45_000,
      });

      expect(countStaleWorkersMock).toHaveBeenCalledWith({
        staleBefore: new Date('2026-08-07T09:59:15.000Z'),
      });
    });
  });

  describe('execution metrics', () => {
    it('calculates execution reliability percentages from terminal attempts', async () => {
      getAttemptMetricsMock.mockResolvedValue({
        _count: {
          _all: 110,
        },
        _avg: {
          durationMs: 245.678,
        },
      });

      countAttemptsByStatusMock.mockResolvedValue([
        {
          status: 'PROCESSING',
          _count: {
            _all: 10,
          },
        },
        {
          status: 'COMPLETED',
          _count: {
            _all: 80,
          },
        },
        {
          status: 'FAILED',
          _count: {
            _all: 15,
          },
        },
        {
          status: 'TIMED_OUT',
          _count: {
            _all: 5,
          },
        },
      ]);

      getAverageAttemptsPerJobMock.mockResolvedValue({
        _avg: {
          attemptCount: 1.378,
        },
      });

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.execution).toEqual({
        totalAttempts: 110,
        processing: 10,
        completed: 80,
        failed: 15,
        timedOut: 5,
        successRate: 80,
        failureRate: 15,
        timeoutRate: 5,
        averageDurationMs: 245.68,
        averageAttemptsPerJob: 1.38,
      });
    });

    it('excludes processing attempts from reliability-rate denominators', async () => {
      countAttemptsByStatusMock.mockResolvedValue([
        {
          status: 'PROCESSING',
          _count: {
            _all: 100,
          },
        },
        {
          status: 'COMPLETED',
          _count: {
            _all: 3,
          },
        },
        {
          status: 'FAILED',
          _count: {
            _all: 1,
          },
        },
      ]);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.execution.successRate).toBe(75);
      expect(result.execution.failureRate).toBe(25);
      expect(result.execution.timeoutRate).toBe(0);
    });

    it('returns zero reliability rates when no terminal attempts exist', async () => {
      countAttemptsByStatusMock.mockResolvedValue([
        {
          status: 'PROCESSING',
          _count: {
            _all: 4,
          },
        },
      ]);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.execution.successRate).toBe(0);
      expect(result.execution.failureRate).toBe(0);
      expect(result.execution.timeoutRate).toBe(0);
    });

    it('rounds non-integer percentages to two decimal places', async () => {
      countAttemptsByStatusMock.mockResolvedValue([
        {
          status: 'COMPLETED',
          _count: {
            _all: 2,
          },
        },
        {
          status: 'FAILED',
          _count: {
            _all: 1,
          },
        },
      ]);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.execution.successRate).toBe(66.67);
      expect(result.execution.failureRate).toBe(33.33);
    });

    it('normalizes null averages to zero', async () => {
      getAttemptMetricsMock.mockResolvedValue({
        _count: {
          _all: 0,
        },
        _avg: {
          durationMs: null,
        },
      });

      getAverageAttemptsPerJobMock.mockResolvedValue({
        _avg: {
          attemptCount: null,
        },
      });

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.execution.averageDurationMs).toBe(0);
      expect(result.execution.averageAttemptsPerJob).toBe(0);
    });
  });

  describe('throughput metrics', () => {
    it('queries rolling one-hour and twenty-four-hour windows', async () => {
      await getPlatformMetrics({
        now: NOW,
      });

      const oneHourAgo = new Date('2026-08-07T09:00:00.000Z');
      const twentyFourHoursAgo = new Date('2026-08-06T10:00:00.000Z');

      expect(countJobsCreatedSinceMock).toHaveBeenNthCalledWith(1, {
        since: oneHourAgo,
      });

      expect(countJobsCompletedSinceMock).toHaveBeenNthCalledWith(1, {
        since: oneHourAgo,
      });

      expect(countAttemptsCreatedSinceMock).toHaveBeenNthCalledWith(1, {
        since: oneHourAgo,
      });

      expect(countJobsCreatedSinceMock).toHaveBeenNthCalledWith(2, {
        since: twentyFourHoursAgo,
      });

      expect(countJobsCompletedSinceMock).toHaveBeenNthCalledWith(2, {
        since: twentyFourHoursAgo,
      });

      expect(countAttemptsCreatedSinceMock).toHaveBeenNthCalledWith(2, {
        since: twentyFourHoursAgo,
      });
    });

    it('maps repository throughput counts into the response', async () => {
      countJobsCreatedSinceMock.mockResolvedValueOnce(8).mockResolvedValueOnce(41);

      countJobsCompletedSinceMock.mockResolvedValueOnce(6).mockResolvedValueOnce(35);

      countAttemptsCreatedSinceMock.mockResolvedValueOnce(9).mockResolvedValueOnce(48);

      const result = await getPlatformMetrics({
        now: NOW,
      });

      expect(result.throughput).toEqual({
        lastHour: {
          jobsCreated: 8,
          jobsCompleted: 6,
          attemptsCreated: 9,
        },

        last24Hours: {
          jobsCreated: 41,
          jobsCompleted: 35,
          attemptsCreated: 48,
        },
      });
    });
  });

  describe('repository orchestration', () => {
    it('loads all independent metrics required for a snapshot', async () => {
      await getPlatformMetrics({
        now: NOW,
      });

      expect(countAllJobsMock).toHaveBeenCalledOnce();
      expect(countJobsByStatusMock).toHaveBeenCalledOnce();
      expect(countClaimableJobsMock).toHaveBeenCalledOnce();
      expect(findOldestClaimableJobMock).toHaveBeenCalledOnce();

      expect(countAllWorkersMock).toHaveBeenCalledOnce();
      expect(countWorkersByStatusMock).toHaveBeenCalledOnce();
      expect(countStaleWorkersMock).toHaveBeenCalledOnce();

      expect(getAttemptMetricsMock).toHaveBeenCalledOnce();
      expect(countAttemptsByStatusMock).toHaveBeenCalledOnce();
      expect(getAverageAttemptsPerJobMock).toHaveBeenCalledOnce();

      expect(countJobsCreatedSinceMock).toHaveBeenCalledTimes(2);
      expect(countJobsCompletedSinceMock).toHaveBeenCalledTimes(2);
      expect(countAttemptsCreatedSinceMock).toHaveBeenCalledTimes(2);
    });

    it('propagates repository failures to the caller', async () => {
      countAllJobsMock.mockRejectedValue(new Error('Metrics database unavailable.'));

      await expect(
        getPlatformMetrics({
          now: NOW,
        }),
      ).rejects.toThrow('Metrics database unavailable.');
    });
  });

  describe('configuration validation', () => {
    it('rejects an invalid observation timestamp', async () => {
      await expect(
        getPlatformMetrics({
          now: new Date('invalid'),
        }),
      ).rejects.toThrow('now must be a valid Date.');
    });

    it('rejects a non-Date observation timestamp', async () => {
      await expect(
        getPlatformMetrics({
          now: '2026-08-07T10:00:00.000Z',
        }),
      ).rejects.toThrow('now must be a valid Date.');
    });

    it.each([0, -1, 1.5, Number.NaN])(
      'rejects invalid stale-worker threshold %s',
      async (staleAfterMs) => {
        await expect(
          getPlatformMetrics({
            now: NOW,
            staleAfterMs,
          }),
        ).rejects.toThrow('staleAfterMs must be a positive integer.');
      },
    );
  });
});
