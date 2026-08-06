/**
 * @file worker-instance.service.test.js
 * @description Unit tests for DispatchIQ worker-instance lifecycle business
 * logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerWorkerMock = vi.fn();
const markWorkerOnlineMock = vi.fn();
const markWorkerBusyMock = vi.fn();
const markWorkerAvailableMock = vi.fn();
const updateWorkerHeartbeatMock = vi.fn();
const markWorkerStoppingMock = vi.fn();
const markWorkerOfflineMock = vi.fn();

vi.mock('./worker-instance.repository.js', () => ({
  registerWorker: registerWorkerMock,
  markWorkerOnline: markWorkerOnlineMock,
  markWorkerBusy: markWorkerBusyMock,
  markWorkerAvailable: markWorkerAvailableMock,
  updateWorkerHeartbeat: updateWorkerHeartbeatMock,
  markWorkerStopping: markWorkerStoppingMock,
  markWorkerOffline: markWorkerOfflineMock,
}));

const {
  heartbeatWorker,
  setWorkerAvailable,
  setWorkerBusy,
  startWorkerInstance,
  stopWorkerInstance,
} = await import('./worker-instance.service.js');

describe('worker-instance service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startWorkerInstance', () => {
    it('registers a worker and transitions it to ONLINE', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');
      const onlineAt = new Date('2026-08-06T10:00:02.000Z');

      const registeredWorker = {
        id: 'worker-123',
        hostname: 'dispatchiq-worker-01',
        status: 'STARTING',
        lastHeartbeatAt: startedAt,
        startedAt,
        stoppedAt: null,
      };

      registerWorkerMock.mockResolvedValue(registeredWorker);
      markWorkerOnlineMock.mockResolvedValue({
        count: 1,
      });

      const result = await startWorkerInstance({
        hostname: registeredWorker.hostname,
        startedAt,
        onlineAt,
      });

      expect(registerWorkerMock).toHaveBeenCalledWith({
        hostname: registeredWorker.hostname,
        startedAt,
      });

      expect(markWorkerOnlineMock).toHaveBeenCalledWith({
        workerId: registeredWorker.id,
        onlineAt,
      });

      expect(result).toEqual({
        ...registeredWorker,
        status: 'ONLINE',
        lastHeartbeatAt: onlineAt,
      });
    });

    it('fails startup when the worker cannot transition to ONLINE', async () => {
      registerWorkerMock.mockResolvedValue({
        id: 'worker-123',
        hostname: 'dispatchiq-worker-01',
        status: 'STARTING',
      });

      markWorkerOnlineMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        startWorkerInstance({
          hostname: 'dispatchiq-worker-01',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker startup failed because the instance could not transition to ONLINE.',
      });
    });
  });

  describe('setWorkerBusy', () => {
    it('transitions an ONLINE worker to BUSY', async () => {
      const busyAt = new Date('2026-08-06T10:01:00.000Z');

      markWorkerBusyMock.mockResolvedValue({
        count: 1,
      });

      await expect(
        setWorkerBusy({
          workerId: 'worker-123',
          busyAt,
        }),
      ).resolves.toBeUndefined();

      expect(markWorkerBusyMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        busyAt,
      });
    });

    it('fails when the worker cannot transition to BUSY', async () => {
      markWorkerBusyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        setWorkerBusy({
          workerId: 'worker-123',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker could not transition from ONLINE to BUSY.',
      });
    });
  });

  describe('setWorkerAvailable', () => {
    it('transitions a BUSY worker back to ONLINE', async () => {
      const onlineAt = new Date('2026-08-06T10:02:00.000Z');

      markWorkerAvailableMock.mockResolvedValue({
        count: 1,
      });

      await expect(
        setWorkerAvailable({
          workerId: 'worker-123',
          onlineAt,
        }),
      ).resolves.toBeUndefined();

      expect(markWorkerAvailableMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        onlineAt,
      });
    });

    it('fails when the worker cannot return to ONLINE', async () => {
      markWorkerAvailableMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        setWorkerAvailable({
          workerId: 'worker-123',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker could not transition from BUSY to ONLINE.',
      });
    });
  });

  describe('heartbeatWorker', () => {
    it('updates the heartbeat for an active worker', async () => {
      const heartbeatAt = new Date('2026-08-06T10:03:00.000Z');

      updateWorkerHeartbeatMock.mockResolvedValue({
        count: 1,
      });

      await expect(
        heartbeatWorker({
          workerId: 'worker-123',
          heartbeatAt,
        }),
      ).resolves.toBeUndefined();

      expect(updateWorkerHeartbeatMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        heartbeatAt,
      });
    });

    it('fails when the worker is no longer active', async () => {
      updateWorkerHeartbeatMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        heartbeatWorker({
          workerId: 'worker-123',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker heartbeat failed because the instance is not active.',
      });
    });
  });

  describe('stopWorkerInstance', () => {
    it('transitions the worker through STOPPING to OFFLINE', async () => {
      const stoppingAt = new Date('2026-08-06T10:04:00.000Z');
      const stoppedAt = new Date('2026-08-06T10:04:02.000Z');

      markWorkerStoppingMock.mockResolvedValue({
        count: 1,
      });

      markWorkerOfflineMock.mockResolvedValue({
        count: 1,
      });

      await expect(
        stopWorkerInstance({
          workerId: 'worker-123',
          stoppingAt,
          stoppedAt,
        }),
      ).resolves.toBeUndefined();

      expect(markWorkerStoppingMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        stoppingAt,
      });

      expect(markWorkerOfflineMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        stoppedAt,
      });
    });

    it('does not mark the worker OFFLINE when STOPPING fails', async () => {
      markWorkerStoppingMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        stopWorkerInstance({
          workerId: 'worker-123',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker shutdown failed because the instance could not transition to STOPPING.',
      });

      expect(markWorkerOfflineMock).not.toHaveBeenCalled();
    });

    it('fails when the worker cannot transition from STOPPING to OFFLINE', async () => {
      markWorkerStoppingMock.mockResolvedValue({
        count: 1,
      });

      markWorkerOfflineMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        stopWorkerInstance({
          workerId: 'worker-123',
        }),
      ).rejects.toMatchObject({
        name: 'WorkerLifecycleError',
        message: 'Worker shutdown failed because the instance could not transition to OFFLINE.',
      });
    });
  });
});
