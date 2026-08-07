/**
 * @file worker.repository.test.js
 * @description Unit tests for DispatchIQ Worker Management API repository
 * queries.
 *
 * Prisma is mocked so these tests verify pagination, lifecycle filtering,
 * worker-detail relations, active-capacity definitions, stale-heartbeat
 * detection, grouped health counts, and bounded execution history without
 * requiring PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerFindManyMock = vi.fn();
const workerCountMock = vi.fn();
const workerFindUniqueMock = vi.fn();
const workerFindFirstMock = vi.fn();
const workerGroupByMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    workerInstance: {
      findMany: workerFindManyMock,
      count: workerCountMock,
      findUnique: workerFindUniqueMock,
      findFirst: workerFindFirstMock,
      groupBy: workerGroupByMock,
    },
  },
}));

const {
  countActiveWorkers,
  countStaleWorkers,
  countWorkers,
  countWorkersByStatus,
  findOldestActiveHeartbeat,
  findWorkerDetailsById,
  findWorkers,
} = await import('./worker.repository.js');

describe('worker repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findWorkers', () => {
    it('returns paginated workers ordered newest first', async () => {
      workerFindManyMock.mockResolvedValue([]);

      await findWorkers({
        skip: 20,
        take: 20,
      });

      expect(workerFindManyMock).toHaveBeenCalledWith({
        where: {},

        orderBy: {
          startedAt: 'desc',
        },

        skip: 20,
        take: 20,

        include: {
          _count: {
            select: {
              lockedJobs: true,
              jobAttempts: true,
            },
          },
        },
      });
    });

    it('filters workers by lifecycle status when provided', async () => {
      workerFindManyMock.mockResolvedValue([]);

      await findWorkers({
        skip: 0,
        take: 25,
        status: 'ONLINE',
      });

      expect(workerFindManyMock).toHaveBeenCalledWith({
        where: {
          status: 'ONLINE',
        },

        orderBy: {
          startedAt: 'desc',
        },

        skip: 0,
        take: 25,

        include: {
          _count: {
            select: {
              lockedJobs: true,
              jobAttempts: true,
            },
          },
        },
      });
    });
  });

  describe('countWorkers', () => {
    it('counts all workers when no status filter is supplied', async () => {
      workerCountMock.mockResolvedValue(8);

      const result = await countWorkers();

      expect(workerCountMock).toHaveBeenCalledWith({
        where: {},
      });

      expect(result).toBe(8);
    });

    it('counts workers using the supplied status filter', async () => {
      workerCountMock.mockResolvedValue(3);

      const result = await countWorkers({
        status: 'BUSY',
      });

      expect(workerCountMock).toHaveBeenCalledWith({
        where: {
          status: 'BUSY',
        },
      });

      expect(result).toBe(3);
    });
  });

  describe('findWorkerDetailsById', () => {
    it('returns worker details with bounded operational context', async () => {
      workerFindUniqueMock.mockResolvedValue({
        id: 'worker-123',
      });

      await findWorkerDetailsById('worker-123');

      expect(workerFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
        },

        include: {
          _count: {
            select: {
              lockedJobs: true,
              jobAttempts: true,
            },
          },

          lockedJobs: {
            select: {
              id: true,
              userId: true,
              type: true,
              status: true,
              priority: true,
              attemptCount: true,
              maxAttempts: true,
              availableAt: true,
              lockedAt: true,
              createdAt: true,
            },

            orderBy: {
              lockedAt: 'asc',
            },
          },

          jobAttempts: {
            select: {
              id: true,
              jobId: true,
              attemptNumber: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              durationMs: true,
              error: true,
            },

            orderBy: {
              startedAt: 'desc',
            },

            take: 25,
          },
        },
      });
    });

    it('returns null when the worker does not exist', async () => {
      workerFindUniqueMock.mockResolvedValue(null);

      await expect(findWorkerDetailsById('missing-worker')).resolves.toBeNull();
    });
  });

  describe('countWorkersByStatus', () => {
    it('groups workers by lifecycle status', async () => {
      workerGroupByMock.mockResolvedValue([
        {
          status: 'ONLINE',
          _count: {
            _all: 2,
          },
        },
      ]);

      const result = await countWorkersByStatus();

      expect(workerGroupByMock).toHaveBeenCalledWith({
        by: ['status'],

        _count: {
          _all: true,
        },
      });

      expect(result).toEqual([
        {
          status: 'ONLINE',
          _count: {
            _all: 2,
          },
        },
      ]);
    });
  });

  describe('countActiveWorkers', () => {
    it('counts STARTING, ONLINE, and BUSY workers as active', async () => {
      workerCountMock.mockResolvedValue(4);

      const result = await countActiveWorkers();

      expect(workerCountMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY'],
          },
        },
      });

      expect(result).toBe(4);
    });
  });

  describe('countStaleWorkers', () => {
    it('counts stale heartbeats only among active worker states', async () => {
      const staleBefore = new Date('2026-08-07T12:00:00.000Z');

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

  describe('findOldestActiveHeartbeat', () => {
    it('returns the active worker with the oldest heartbeat', async () => {
      const worker = {
        id: 'worker-123',
        hostname: 'dispatchiq-worker-01',
        status: 'ONLINE',
        lastHeartbeatAt: new Date('2026-08-07T12:00:00.000Z'),
      };

      workerFindFirstMock.mockResolvedValue(worker);

      const result = await findOldestActiveHeartbeat();

      expect(workerFindFirstMock).toHaveBeenCalledWith({
        where: {
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY'],
          },
        },

        orderBy: {
          lastHeartbeatAt: 'asc',
        },

        select: {
          id: true,
          hostname: true,
          status: true,
          lastHeartbeatAt: true,
        },
      });

      expect(result).toEqual(worker);
    });

    it('returns null when no active workers exist', async () => {
      workerFindFirstMock.mockResolvedValue(null);

      await expect(findOldestActiveHeartbeat()).resolves.toBeNull();
    });
  });
});
