/**
 * @file worker.service.test.js
 * @description Unit tests for DispatchIQ Worker Management API business logic.
 *
 * Repository operations are mocked so these tests verify pagination,
 * lifecycle-count normalization, heartbeat-age calculations, stale-worker
 * interpretation, worker health classification, cluster health, and
 * application-level not-found behavior without PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findWorkersMock = vi.fn();
const countWorkersMock = vi.fn();
const findWorkerDetailsByIdMock = vi.fn();
const countWorkersByStatusMock = vi.fn();
const countActiveWorkersMock = vi.fn();
const countStaleWorkersMock = vi.fn();
const findOldestActiveHeartbeatMock = vi.fn();

vi.mock('./worker.repository.js', () => ({
  findWorkers: findWorkersMock,
  countWorkers: countWorkersMock,
  findWorkerDetailsById: findWorkerDetailsByIdMock,
  countWorkersByStatus: countWorkersByStatusMock,
  countActiveWorkers: countActiveWorkersMock,
  countStaleWorkers: countStaleWorkersMock,
  findOldestActiveHeartbeat: findOldestActiveHeartbeatMock,
}));

const { getWorker, getWorkerHealth, listWorkers } = await import('./worker.service.js');

describe('worker service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listWorkers', () => {
    it('returns paginated workers with health metadata', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      findWorkersMock.mockResolvedValue([
        {
          id: 'worker-1',
          hostname: 'worker-a',
          status: 'ONLINE',
          lastHeartbeatAt: new Date('2026-08-07T11:59:45.000Z'),
          _count: {
            lockedJobs: 0,
            jobAttempts: 12,
          },
        },
      ]);

      countWorkersMock.mockResolvedValue(1);

      const result = await listWorkers(
        {
          page: 1,
          limit: 20,
          status: 'ONLINE',
        },
        {
          asOf,
          staleAfterMs: 60_000,
        },
      );

      expect(findWorkersMock).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        status: 'ONLINE',
      });

      expect(countWorkersMock).toHaveBeenCalledWith({
        status: 'ONLINE',
      });

      expect(result).toMatchObject({
        workers: [
          {
            id: 'worker-1',
            health: {
              heartbeatAgeMs: 15_000,
              isStale: false,
              health: 'healthy',
            },
          },
        ],

        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        },
      });
    });

    it('applies default pagination', async () => {
      findWorkersMock.mockResolvedValue([]);

      countWorkersMock.mockResolvedValue(0);

      const result = await listWorkers();

      expect(findWorkersMock).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        status: undefined,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('calculates the correct pagination offset', async () => {
      findWorkersMock.mockResolvedValue([]);

      countWorkersMock.mockResolvedValue(45);

      const result = await listWorkers({
        page: 3,
        limit: 10,
      });

      expect(findWorkersMock).toHaveBeenCalledWith({
        skip: 20,
        take: 10,
        status: undefined,
      });

      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    it('marks stale active workers as unhealthy', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      findWorkersMock.mockResolvedValue([
        {
          id: 'worker-1',
          status: 'BUSY',
          lastHeartbeatAt: new Date('2026-08-07T11:58:00.000Z'),
        },
      ]);

      countWorkersMock.mockResolvedValue(1);

      const result = await listWorkers(
        {},
        {
          asOf,
          staleAfterMs: 60_000,
        },
      );

      expect(result.workers[0].health).toEqual({
        heartbeatAgeMs: 120_000,
        isStale: true,
        health: 'unhealthy',
      });
    });

    it('classifies STARTING workers as degraded when their heartbeat is fresh', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      findWorkersMock.mockResolvedValue([
        {
          id: 'worker-1',
          status: 'STARTING',
          lastHeartbeatAt: new Date('2026-08-07T11:59:55.000Z'),
        },
      ]);

      countWorkersMock.mockResolvedValue(1);

      const result = await listWorkers(
        {},
        {
          asOf,
          staleAfterMs: 60_000,
        },
      );

      expect(result.workers[0].health.health).toBe('degraded');
    });

    it('classifies OFFLINE and STOPPING workers explicitly', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      findWorkersMock.mockResolvedValue([
        {
          id: 'offline',
          status: 'OFFLINE',
          lastHeartbeatAt: new Date('2026-08-07T10:00:00.000Z'),
        },
        {
          id: 'stopping',
          status: 'STOPPING',
          lastHeartbeatAt: new Date('2026-08-07T11:59:59.000Z'),
        },
      ]);

      countWorkersMock.mockResolvedValue(2);

      const result = await listWorkers(
        {},
        {
          asOf,
          staleAfterMs: 60_000,
        },
      );

      expect(result.workers[0].health).toMatchObject({
        isStale: false,
        health: 'offline',
      });

      expect(result.workers[1].health).toMatchObject({
        isStale: false,
        health: 'stopping',
      });
    });
  });

  describe('getWorker', () => {
    it('returns detailed worker health information', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      findWorkerDetailsByIdMock.mockResolvedValue({
        id: 'worker-123',
        status: 'ONLINE',
        lastHeartbeatAt: new Date('2026-08-07T11:59:30.000Z'),
        lockedJobs: [],
        jobAttempts: [],
      });

      const result = await getWorker('worker-123', {
        asOf,
        staleAfterMs: 60_000,
      });

      expect(findWorkerDetailsByIdMock).toHaveBeenCalledWith('worker-123');

      expect(result).toMatchObject({
        id: 'worker-123',

        health: {
          heartbeatAgeMs: 30_000,
          isStale: false,
          health: 'healthy',
        },
      });
    });

    it('throws WORKER_NOT_FOUND for an unknown worker', async () => {
      findWorkerDetailsByIdMock.mockResolvedValue(null);

      await expect(getWorker('missing-worker')).rejects.toMatchObject({
        message: 'Worker was not found.',
        statusCode: 404,
        code: 'WORKER_NOT_FOUND',
      });
    });
  });

  describe('getWorkerHealth', () => {
    it('returns healthy when active workers exist without stale or unhealthy instances', async () => {
      const asOf = new Date('2026-08-07T12:00:00.000Z');

      countWorkersByStatusMock.mockResolvedValue([
        {
          status: 'ONLINE',
          _count: {
            _all: 3,
          },
        },
      ]);

      countActiveWorkersMock.mockResolvedValue(3);

      countStaleWorkersMock.mockResolvedValue(0);

      findOldestActiveHeartbeatMock.mockResolvedValue({
        id: 'worker-1',
        hostname: 'worker-a',
        status: 'ONLINE',
        lastHeartbeatAt: new Date('2026-08-07T11:59:40.000Z'),
      });

      const result = await getWorkerHealth({
        asOf,
        staleAfterMs: 60_000,
      });

      expect(countStaleWorkersMock).toHaveBeenCalledWith({
        staleBefore: new Date('2026-08-07T11:59:00.000Z'),
      });

      expect(result.health).toBe('healthy');

      expect(result.workers).toEqual({
        active: 3,
        stale: 0,

        byStatus: {
          STARTING: 0,
          ONLINE: 3,
          BUSY: 0,
          UNHEALTHY: 0,
          OFFLINE: 0,
          STOPPING: 0,
        },
      });

      expect(result.oldestActiveHeartbeat).toMatchObject({
        id: 'worker-1',
        heartbeatAgeMs: 20_000,
      });
    });

    it('returns degraded when active workers include stale instances', async () => {
      countWorkersByStatusMock.mockResolvedValue([
        {
          status: 'ONLINE',
          _count: {
            _all: 2,
          },
        },
      ]);

      countActiveWorkersMock.mockResolvedValue(2);

      countStaleWorkersMock.mockResolvedValue(1);

      findOldestActiveHeartbeatMock.mockResolvedValue(null);

      const result = await getWorkerHealth();

      expect(result.health).toBe('degraded');
    });

    it('returns degraded when an explicit UNHEALTHY worker exists', async () => {
      countWorkersByStatusMock.mockResolvedValue([
        {
          status: 'ONLINE',
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
      ]);

      countActiveWorkersMock.mockResolvedValue(2);

      countStaleWorkersMock.mockResolvedValue(0);

      findOldestActiveHeartbeatMock.mockResolvedValue(null);

      const result = await getWorkerHealth();

      expect(result.health).toBe('degraded');
    });

    it('returns unavailable when no active workers exist', async () => {
      countWorkersByStatusMock.mockResolvedValue([
        {
          status: 'OFFLINE',
          _count: {
            _all: 4,
          },
        },
      ]);

      countActiveWorkersMock.mockResolvedValue(0);

      countStaleWorkersMock.mockResolvedValue(0);

      findOldestActiveHeartbeatMock.mockResolvedValue(null);

      const result = await getWorkerHealth();

      expect(result.health).toBe('unavailable');

      expect(result.oldestActiveHeartbeat).toBeNull();
    });
  });
});
