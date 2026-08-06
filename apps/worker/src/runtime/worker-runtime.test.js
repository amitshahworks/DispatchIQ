/**
 * @file worker-runtime.test.js
 * @description Unit tests for the DispatchIQ worker runtime coordinator.
 *
 * These tests verify startup, polling, lifecycle state transitions,
 * overlapping-poll prevention, error reporting, and graceful shutdown.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const claimNextJobMock = vi.fn();

const startWorkerInstanceMock = vi.fn();
const setWorkerBusyMock = vi.fn();
const setWorkerAvailableMock = vi.fn();
const stopWorkerInstanceMock = vi.fn();

const startHeartbeatMock = vi.fn();
const heartbeatStopMock = vi.fn();

vi.mock('../jobs/worker.repository.js', () => ({
  claimNextJob: claimNextJobMock,
}));

vi.mock('../worker-instance/worker-instance.service.js', () => ({
  startWorkerInstance: startWorkerInstanceMock,
  setWorkerBusy: setWorkerBusyMock,
  setWorkerAvailable: setWorkerAvailableMock,
  stopWorkerInstance: stopWorkerInstanceMock,
}));

vi.mock('./heartbeat.js', () => ({
  startHeartbeat: startHeartbeatMock,
}));

const { createWorkerRuntime } = await import('./worker-runtime.js');

/**
 * Creates a runtime using deterministic timestamps and timer mocks.
 *
 * @param {Partial<Parameters<typeof createWorkerRuntime>[0]>} overrides
 * Optional runtime overrides.
 * @returns {{
 *   runtime: ReturnType<typeof createWorkerRuntime>,
 *   setIntervalMock: ReturnType<typeof vi.fn>,
 *   clearIntervalMock: ReturnType<typeof vi.fn>,
 *   now: ReturnType<typeof vi.fn>
 * }}
 */
function createRuntime(overrides = {}) {
  const currentTime = new Date('2026-08-06T10:00:00.000Z');

  const now = vi.fn(() => currentTime);
  const setIntervalMock = vi.fn(() => 'timer-123');
  const clearIntervalMock = vi.fn();

  const runtime = createWorkerRuntime({
    hostname: 'dispatchiq-worker-01',
    pollIntervalMs: 1_000,
    heartbeatIntervalMs: 10_000,
    processClaim: vi.fn().mockResolvedValue(undefined),
    now,
    setIntervalFn: setIntervalMock,
    clearIntervalFn: clearIntervalMock,
    ...overrides,
  });

  return {
    runtime,
    setIntervalMock,
    clearIntervalMock,
    now,
  };
}

describe('worker runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    startWorkerInstanceMock.mockResolvedValue({
      id: 'worker-123',
      hostname: 'dispatchiq-worker-01',
      status: 'ONLINE',
    });

    startHeartbeatMock.mockReturnValue({
      stop: heartbeatStopMock,
      runNow: vi.fn(),
      isRunning: vi.fn(() => true),
    });

    heartbeatStopMock.mockResolvedValue(undefined);
    setWorkerBusyMock.mockResolvedValue(undefined);
    setWorkerAvailableMock.mockResolvedValue(undefined);
    stopWorkerInstanceMock.mockResolvedValue(undefined);
  });

  describe('start', () => {
    it('registers a worker and starts heartbeat and polling', async () => {
      const { runtime, setIntervalMock, now } = createRuntime();

      const worker = await runtime.start();

      expect(startWorkerInstanceMock).toHaveBeenCalledWith({
        hostname: 'dispatchiq-worker-01',
        startedAt: now.mock.results[0].value,
        onlineAt: now.mock.results[0].value,
      });

      expect(startHeartbeatMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        intervalMs: 10_000,
        now,
        setIntervalFn: setIntervalMock,
        clearIntervalFn: expect.any(Function),
        onError: expect.any(Function),
      });

      expect(setIntervalMock).toHaveBeenCalledTimes(1);

      expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 1_000);

      expect(worker).toMatchObject({
        id: 'worker-123',
        status: 'ONLINE',
      });

      expect(runtime.getWorkerId()).toBe('worker-123');
      expect(runtime.isRunning()).toBe(true);
    });

    it('does not register the same runtime more than once', async () => {
      const { runtime } = createRuntime();

      const firstWorker = await runtime.start();
      const secondWorker = await runtime.start();

      expect(startWorkerInstanceMock).toHaveBeenCalledOnce();
      expect(secondWorker).toBe(firstWorker);
    });
  });

  describe('pollNow', () => {
    it('does nothing before the runtime starts', async () => {
      const processClaim = vi.fn();
      const { runtime } = createRuntime({
        processClaim,
      });

      await runtime.pollNow();

      expect(claimNextJobMock).not.toHaveBeenCalled();
      expect(processClaim).not.toHaveBeenCalled();
    });

    it('does nothing when no claimable job exists', async () => {
      claimNextJobMock.mockResolvedValue(null);

      const processClaim = vi.fn();
      const { runtime } = createRuntime({
        processClaim,
      });

      await runtime.start();
      await runtime.pollNow();

      expect(claimNextJobMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        claimedAt: expect.any(Date),
      });

      expect(setWorkerBusyMock).not.toHaveBeenCalled();
      expect(processClaim).not.toHaveBeenCalled();
    });

    it('processes a claimed job through BUSY and ONLINE states', async () => {
      const claim = {
        job: {
          id: 'job-123',
          type: 'EMAIL',
        },
        attempt: {
          id: 'attempt-123',
        },
      };

      claimNextJobMock.mockResolvedValue(claim);

      const processClaim = vi.fn().mockResolvedValue(undefined);

      const { runtime } = createRuntime({
        processClaim,
      });

      await runtime.start();
      await runtime.pollNow();

      expect(setWorkerBusyMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        busyAt: expect.any(Date),
      });

      expect(processClaim).toHaveBeenCalledOnce();
      expect(processClaim).toHaveBeenCalledWith(claim);

      expect(setWorkerAvailableMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        onlineAt: expect.any(Date),
      });
    });

    it('prevents overlapping polling cycles', async () => {
      let resolveClaim;

      claimNextJobMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClaim = resolve;
          }),
      );

      const { runtime } = createRuntime();

      await runtime.start();

      const firstPoll = runtime.pollNow();

      await runtime.pollNow();

      expect(claimNextJobMock).toHaveBeenCalledOnce();

      resolveClaim(null);

      await firstPoll;
    });

    it('reports processor failures and returns the worker to ONLINE', async () => {
      const error = new Error('Handler execution failed.');
      const onError = vi.fn();

      claimNextJobMock.mockResolvedValue({
        job: {
          id: 'job-123',
        },
        attempt: {
          id: 'attempt-123',
        },
      });

      const { runtime } = createRuntime({
        processClaim: vi.fn().mockRejectedValue(error),
        onError,
      });

      await runtime.start();
      await runtime.pollNow();

      expect(onError).toHaveBeenCalledWith(error);

      expect(setWorkerAvailableMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        onlineAt: expect.any(Date),
      });
    });

    it('reports claim failures without terminating the runtime', async () => {
      const error = new Error('Database unavailable.');
      const onError = vi.fn();

      claimNextJobMock.mockRejectedValue(error);

      const { runtime } = createRuntime({
        onError,
      });

      await runtime.start();

      await expect(runtime.pollNow()).resolves.toBeUndefined();

      expect(onError).toHaveBeenCalledWith(error);
      expect(runtime.isRunning()).toBe(true);
    });
  });

  describe('stop', () => {
    it('stops polling and heartbeat before marking the worker offline', async () => {
      const { runtime, clearIntervalMock } = createRuntime();

      await runtime.start();
      await runtime.stop();

      expect(clearIntervalMock).toHaveBeenCalledWith('timer-123');

      expect(heartbeatStopMock).toHaveBeenCalledOnce();

      expect(stopWorkerInstanceMock).toHaveBeenCalledWith({
        workerId: 'worker-123',
        stoppingAt: expect.any(Date),
        stoppedAt: expect.any(Date),
      });

      expect(runtime.isRunning()).toBe(false);
      expect(runtime.isStopping()).toBe(false);
    });

    it('waits for active job processing before completing shutdown', async () => {
      let resolveProcessing;
      let shutdownResolved = false;

      claimNextJobMock.mockResolvedValue({
        job: {
          id: 'job-123',
        },
        attempt: {
          id: 'attempt-123',
        },
      });

      const processClaim = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveProcessing = resolve;
          }),
      );

      const { runtime } = createRuntime({
        processClaim,
      });

      await runtime.start();

      const polling = runtime.pollNow();

      await vi.waitFor(() => {
        expect(processClaim).toHaveBeenCalledOnce();
      });

      const shutdown = runtime.stop().then(() => {
        shutdownResolved = true;
      });

      await Promise.resolve();

      expect(runtime.isStopping()).toBe(true);
      expect(shutdownResolved).toBe(false);

      resolveProcessing();

      await polling;
      await shutdown;

      expect(setWorkerAvailableMock).not.toHaveBeenCalled();

      expect(stopWorkerInstanceMock).toHaveBeenCalledOnce();
      expect(shutdownResolved).toBe(true);
    });

    it('supports idempotent shutdown', async () => {
      const { runtime } = createRuntime();

      await runtime.start();
      await runtime.stop();
      await runtime.stop();

      expect(heartbeatStopMock).toHaveBeenCalledOnce();
      expect(stopWorkerInstanceMock).toHaveBeenCalledOnce();
    });

    it('can stop safely before startup', async () => {
      const { runtime } = createRuntime();

      await expect(runtime.stop()).resolves.toBeUndefined();

      expect(stopWorkerInstanceMock).not.toHaveBeenCalled();
      expect(runtime.isRunning()).toBe(false);
    });

    it('does not allow restart after shutdown', async () => {
      const { runtime } = createRuntime();

      await runtime.start();
      await runtime.stop();

      await expect(runtime.start()).rejects.toThrow(
        'A stopped worker runtime cannot be started again.',
      );
    });
  });

  describe('configuration validation', () => {
    it('rejects an empty hostname', () => {
      expect(() =>
        createWorkerRuntime({
          hostname: '   ',
          pollIntervalMs: 1_000,
          heartbeatIntervalMs: 10_000,
          processClaim: vi.fn(),
        }),
      ).toThrow('Worker runtime requires a valid hostname.');
    });

    it.each([0, -1, 1.5, Number.NaN])('rejects invalid polling interval %s', (pollIntervalMs) => {
      expect(() =>
        createWorkerRuntime({
          hostname: 'worker-01',
          pollIntervalMs,
          heartbeatIntervalMs: 10_000,
          processClaim: vi.fn(),
        }),
      ).toThrow('Worker pollIntervalMs must be a positive integer.');
    });

    it.each([0, -1, 1.5, Number.NaN])(
      'rejects invalid heartbeat interval %s',
      (heartbeatIntervalMs) => {
        expect(() =>
          createWorkerRuntime({
            hostname: 'worker-01',
            pollIntervalMs: 1_000,
            heartbeatIntervalMs,
            processClaim: vi.fn(),
          }),
        ).toThrow('Worker heartbeatIntervalMs must be a positive integer.');
      },
    );

    it('rejects a missing claim processor', () => {
      expect(() =>
        createWorkerRuntime({
          hostname: 'worker-01',
          pollIntervalMs: 1_000,
          heartbeatIntervalMs: 10_000,
        }),
      ).toThrow('Worker runtime requires a processClaim function.');
    });
  });
});
