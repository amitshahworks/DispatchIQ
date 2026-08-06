/**
 * @file worker-instance.repository.test.js
 * @description Unit tests for DispatchIQ worker-instance lifecycle persistence.
 *
 * Prisma is mocked so these tests verify database query construction without
 * requiring a running PostgreSQL container.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerCreateMock = vi.fn();
const workerUpdateManyMock = vi.fn();
const workerFindUniqueMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    workerInstance: {
      create: workerCreateMock,
      updateMany: workerUpdateManyMock,
      findUnique: workerFindUniqueMock,
    },
  },
}));

const {
  findWorkerById,
  markWorkerAvailable,
  markWorkerBusy,
  markWorkerOffline,
  markWorkerOnline,
  markWorkerStopping,
  registerWorker,
  updateWorkerHeartbeat,
} = await import('./worker-instance.repository.js');

describe('worker-instance repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('registerWorker', () => {
    it('registers a worker in STARTING status', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');

      const worker = {
        id: 'worker-123',
        hostname: 'dispatchiq-worker-01',
        status: 'STARTING',
        startedAt,
        lastHeartbeatAt: startedAt,
        stoppedAt: null,
      };

      workerCreateMock.mockResolvedValue(worker);

      const result = await registerWorker({
        hostname: 'dispatchiq-worker-01',
        startedAt,
      });

      expect(workerCreateMock).toHaveBeenCalledWith({
        data: {
          hostname: 'dispatchiq-worker-01',
          status: 'STARTING',
          startedAt,
          lastHeartbeatAt: startedAt,
        },
      });

      expect(result).toEqual(worker);
    });
  });

  describe('markWorkerOnline', () => {
    it('transitions a STARTING worker to ONLINE', async () => {
      const onlineAt = new Date('2026-08-06T10:00:05.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await markWorkerOnline({
        workerId: 'worker-123',
        onlineAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: 'STARTING',
        },
        data: {
          status: 'ONLINE',
          lastHeartbeatAt: onlineAt,
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });
  });

  describe('markWorkerBusy', () => {
    it('transitions an ONLINE worker to BUSY', async () => {
      const busyAt = new Date('2026-08-06T10:01:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await markWorkerBusy({
        workerId: 'worker-123',
        busyAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: 'ONLINE',
        },
        data: {
          status: 'BUSY',
          lastHeartbeatAt: busyAt,
        },
      });
    });
  });

  describe('markWorkerAvailable', () => {
    it('transitions a BUSY worker back to ONLINE', async () => {
      const onlineAt = new Date('2026-08-06T10:02:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await markWorkerAvailable({
        workerId: 'worker-123',
        onlineAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: 'BUSY',
        },
        data: {
          status: 'ONLINE',
          lastHeartbeatAt: onlineAt,
        },
      });
    });
  });

  describe('updateWorkerHeartbeat', () => {
    it('updates heartbeat for an active worker state', async () => {
      const heartbeatAt = new Date('2026-08-06T10:03:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await updateWorkerHeartbeat({
        workerId: 'worker-123',
        heartbeatAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY', 'STOPPING'],
          },
        },
        data: {
          lastHeartbeatAt: heartbeatAt,
        },
      });
    });
  });

  describe('markWorkerStopping', () => {
    it('transitions a running worker to STOPPING', async () => {
      const stoppingAt = new Date('2026-08-06T10:04:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await markWorkerStopping({
        workerId: 'worker-123',
        stoppingAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: {
            in: ['STARTING', 'ONLINE', 'BUSY', 'UNHEALTHY'],
          },
        },
        data: {
          status: 'STOPPING',
          lastHeartbeatAt: stoppingAt,
        },
      });
    });
  });

  describe('markWorkerOffline', () => {
    it('transitions a STOPPING worker to OFFLINE', async () => {
      const stoppedAt = new Date('2026-08-06T10:05:00.000Z');

      workerUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await markWorkerOffline({
        workerId: 'worker-123',
        stoppedAt,
      });

      expect(workerUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
          status: 'STOPPING',
        },
        data: {
          status: 'OFFLINE',
          lastHeartbeatAt: stoppedAt,
          stoppedAt,
        },
      });
    });
  });

  describe('findWorkerById', () => {
    it('finds a worker instance by ID', async () => {
      const worker = {
        id: 'worker-123',
        hostname: 'dispatchiq-worker-01',
        status: 'ONLINE',
      };

      workerFindUniqueMock.mockResolvedValue(worker);

      const result = await findWorkerById('worker-123');

      expect(workerFindUniqueMock).toHaveBeenCalledWith({
        where: {
          id: 'worker-123',
        },
      });

      expect(result).toEqual(worker);
    });

    it('returns null when the worker does not exist', async () => {
      workerFindUniqueMock.mockResolvedValue(null);

      await expect(findWorkerById('unknown-worker')).resolves.toBeNull();
    });
  });
});
