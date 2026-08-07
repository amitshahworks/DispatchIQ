/**
 * @file metrics.repository.test.js
 * @description Unit tests for DispatchIQ platform metrics persistence.
 *
 * Prisma is mocked so these tests verify aggregate query construction for
 * queue metrics, worker health, execution attempts, throughput windows, and
 * claimable-job monitoring without requiring a running PostgreSQL database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobGroupByMock = vi.fn();
const jobCountMock = vi.fn();
const jobAggregateMock = vi.fn();
const jobFindFirstMock = vi.fn();

const workerGroupByMock = vi.fn();
const workerCountMock = vi.fn();

const attemptAggregateMock = vi.fn();
const attemptCountMock = vi.fn();
const attemptGroupByMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    job: {
      groupBy: jobGroupByMock,
      count: jobCountMock,
      aggregate: jobAggregateMock,
      findFirst: jobFindFirstMock,
    },
    workerInstance: {
      groupBy: workerGroupByMock,
      count: workerCountMock,
    },
    jobAttempt: {
      aggregate: attemptAggregateMock,
      count: attemptCountMock,
      groupBy: attemptGroupByMock,
    },
  },
}));

const {
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
} = await import('./metrics.repository.js');

describe('metrics repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('countJobsByStatus', () => {
    it('groups jobs by lifecycle status', async () => {
      const groupedJobs = [
        {
          status: 'QUEUED',
          _count: {
            _all: 4,
          },
        },
        {
          status: 'COMPLETED',
          _count: {
            _all: 12,
          },
        },
      ];

      jobGroupByMock.mockResolvedValue(groupedJobs);

      const result = await countJobsByStatus();

      expect(jobGroupByMock).toHaveBeenCalledWith({
        by: ['status'],
        _count: {
          _all: true,
        },
      });

      expect(result).toEqual(groupedJobs);
    });
  });

  describe('countAllJobs', () => {
    it('returns the total number of jobs', async () => {
      jobCountMock.mockResolvedValue(42);

      const result = await countAllJobs();

      expect(jobCountMock).toHaveBeenCalledWith();
      expect(result).toBe(42);
    });
  });

  describe('countWorkersByStatus', () => {
    it('groups worker instances by lifecycle status', async () => {
      const groupedWorkers = [
        {
          status: 'ONLINE',
          _count: {
            _all: 2,
          },
        },
        {
          status: 'BUSY',
          _count: {
            _all: 1,
          },
        },
      ];

      workerGroupByMock.mockResolvedValue(groupedWorkers);

      const result = await countWorkersByStatus();

      expect(workerGroupByMock).toHaveBeenCalledWith({
        by: ['status'],
        _count: {
          _all: true,
        },
      });

      expect(result).toEqual(groupedWorkers);
    });
  });

  describe('countAllWorkers', () => {
    it('returns the total number of worker instances', async () => {
      workerCountMock.mockResolvedValue(6);

      const result = await countAllWorkers();

      expect(workerCountMock).toHaveBeenCalledWith();
      expect(result).toBe(6);
    });
  });

  describe('countStaleWorkers', () => {
    it('counts runtime-active workers older than the stale cutoff', async () => {
      const staleBefore = new Date('2026-08-07T10:00:00.000Z');

      workerCountMock.mockResolvedValue(2);

      const result = await countStaleWorkers({
        staleBefore,
      });

      expect(workerCountMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY'],
          },
          lastHeartbeatAt: {
            lte: staleBefore,
          },
        },
      });

      expect(result).toBe(2);
    });
  });

  describe('getAttemptMetrics', () => {
    it('returns total execution count and average duration', async () => {
      const metrics = {
        _count: {
          _all: 28,
        },
        _avg: {
          durationMs: 245.5,
        },
      };

      attemptAggregateMock.mockResolvedValue(metrics);

      const result = await getAttemptMetrics();

      expect(attemptAggregateMock).toHaveBeenCalledWith({
        _count: {
          _all: true,
        },
        _avg: {
          durationMs: true,
        },
      });

      expect(result).toEqual(metrics);
    });

    it('supports a null average duration when no finished attempts exist', async () => {
      attemptAggregateMock.mockResolvedValue({
        _count: {
          _all: 0,
        },
        _avg: {
          durationMs: null,
        },
      });

      await expect(getAttemptMetrics()).resolves.toEqual({
        _count: {
          _all: 0,
        },
        _avg: {
          durationMs: null,
        },
      });
    });
  });

  describe('getAverageAttemptsPerJob', () => {
    it('returns the average persisted attempt count', async () => {
      jobAggregateMock.mockResolvedValue({
        _avg: {
          attemptCount: 1.4,
        },
      });

      const result = await getAverageAttemptsPerJob();

      expect(jobAggregateMock).toHaveBeenCalledWith({
        _avg: {
          attemptCount: true,
        },
      });

      expect(result).toEqual({
        _avg: {
          attemptCount: 1.4,
        },
      });
    });
  });

  describe('countJobsCreatedSince', () => {
    it('counts jobs created within the supplied reporting window', async () => {
      const since = new Date('2026-08-07T09:00:00.000Z');

      jobCountMock.mockResolvedValue(7);

      const result = await countJobsCreatedSince({
        since,
      });

      expect(jobCountMock).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: since,
          },
        },
      });

      expect(result).toBe(7);
    });
  });

  describe('countJobsCompletedSince', () => {
    it('counts completed jobs using completedAt rather than updatedAt', async () => {
      const since = new Date('2026-08-07T09:00:00.000Z');

      jobCountMock.mockResolvedValue(5);

      const result = await countJobsCompletedSince({
        since,
      });

      expect(jobCountMock).toHaveBeenCalledWith({
        where: {
          status: 'COMPLETED',
          completedAt: {
            gte: since,
          },
        },
      });

      expect(result).toBe(5);
    });
  });

  describe('countAttemptsCreatedSince', () => {
    it('counts execution attempts created within the supplied window', async () => {
      const since = new Date('2026-08-07T09:00:00.000Z');

      attemptCountMock.mockResolvedValue(9);

      const result = await countAttemptsCreatedSince({
        since,
      });

      expect(attemptCountMock).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: since,
          },
        },
      });

      expect(result).toBe(9);
    });
  });

  describe('countAttemptsByStatus', () => {
    it('groups execution attempts by outcome status', async () => {
      const groupedAttempts = [
        {
          status: 'COMPLETED',
          _count: {
            _all: 20,
          },
        },
        {
          status: 'FAILED',
          _count: {
            _all: 4,
          },
        },
        {
          status: 'TIMED_OUT',
          _count: {
            _all: 1,
          },
        },
      ];

      attemptGroupByMock.mockResolvedValue(groupedAttempts);

      const result = await countAttemptsByStatus();

      expect(attemptGroupByMock).toHaveBeenCalledWith({
        by: ['status'],
        _count: {
          _all: true,
        },
      });

      expect(result).toEqual(groupedAttempts);
    });
  });

  describe('findOldestClaimableJob', () => {
    it('finds the oldest unlocked job currently eligible for claiming', async () => {
      const asOf = new Date('2026-08-07T10:00:00.000Z');

      const job = {
        id: 'job-123',
        status: 'QUEUED',
        priority: 'HIGH',
        availableAt: new Date('2026-08-07T09:55:00.000Z'),
        createdAt: new Date('2026-08-07T09:50:00.000Z'),
      };

      jobFindFirstMock.mockResolvedValue(job);

      const result = await findOldestClaimableJob({
        asOf,
      });

      expect(jobFindFirstMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['SCHEDULED', 'QUEUED', 'RETRYING'],
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

      expect(result).toEqual(job);
    });

    it('returns null when no job is currently claimable', async () => {
      jobFindFirstMock.mockResolvedValue(null);

      await expect(
        findOldestClaimableJob({
          asOf: new Date('2026-08-07T10:00:00.000Z'),
        }),
      ).resolves.toBeNull();
    });

    it('uses the current time when asOf is omitted', async () => {
      jobFindFirstMock.mockResolvedValue(null);

      await findOldestClaimableJob();

      const query = jobFindFirstMock.mock.calls[0][0];

      expect(query.where.availableAt.lte).toBeInstanceOf(Date);
    });
  });

  describe('countClaimableJobs', () => {
    it('counts unlocked QUEUED and RETRYING jobs available now', async () => {
      const asOf = new Date('2026-08-07T10:00:00.000Z');

      jobCountMock.mockResolvedValue(6);

      const result = await countClaimableJobs({
        asOf,
      });

      expect(jobCountMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['SCHEDULED', 'QUEUED', 'RETRYING'],
          },
          availableAt: {
            lte: asOf,
          },
          lockedByWorkerId: null,
        },
      });

      expect(result).toBe(6);
    });

    it('uses the current time when asOf is omitted', async () => {
      jobCountMock.mockResolvedValue(0);

      await countClaimableJobs();

      const query = jobCountMock.mock.calls[0][0];

      expect(query.where.availableAt.lte).toBeInstanceOf(Date);
    });
  });
});
