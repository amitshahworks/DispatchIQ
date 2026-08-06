/**
 * @file heartbeat.test.js
 * @description Unit tests for the DispatchIQ worker heartbeat scheduler.
 *
 * These tests verify recurring scheduling, immediate execution, overlap
 * prevention, error reporting, graceful shutdown behavior, and configuration
 * validation without relying on real timers or database access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const heartbeatWorkerMock = vi.fn();

vi.mock('../worker-instance/worker-instance.service.js', () => ({
  heartbeatWorker: heartbeatWorkerMock,
}));

const { startHeartbeat } = await import('./heartbeat.js');

describe('heartbeat runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a recurring timer using the configured interval', () => {
    const setIntervalMock = vi.fn(() => 'timer-123');
    const clearIntervalMock = vi.fn();

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      setIntervalFn: setIntervalMock,
      clearIntervalFn: clearIntervalMock,
    });

    expect(setIntervalMock).toHaveBeenCalledOnce();
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 10_000);

    expect(heartbeat.isRunning()).toBe(true);
  });

  it('persists an immediate heartbeat through runNow', async () => {
    const heartbeatAt = new Date('2026-08-06T10:00:00.000Z');

    heartbeatWorkerMock.mockResolvedValue(undefined);

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      now: () => heartbeatAt,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: vi.fn(),
    });

    await heartbeat.runNow();

    expect(heartbeatWorkerMock).toHaveBeenCalledOnce();

    expect(heartbeatWorkerMock).toHaveBeenCalledWith({
      workerId: 'worker-123',
      heartbeatAt,
    });
  });

  it('executes heartbeats when the timer callback fires', async () => {
    let timerCallback;

    const setIntervalMock = vi.fn((callback) => {
      timerCallback = callback;

      return 'timer-123';
    });

    heartbeatWorkerMock.mockResolvedValue(undefined);

    startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 5_000,
      setIntervalFn: setIntervalMock,
      clearIntervalFn: vi.fn(),
    });

    timerCallback();

    await vi.waitFor(() => {
      expect(heartbeatWorkerMock).toHaveBeenCalledOnce();
    });
  });

  it('prevents overlapping heartbeat executions', async () => {
    let resolveFirstHeartbeat;

    heartbeatWorkerMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstHeartbeat = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 1_000,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: vi.fn(),
    });

    const firstHeartbeat = heartbeat.runNow();

    await heartbeat.runNow();

    expect(heartbeatWorkerMock).toHaveBeenCalledTimes(1);

    resolveFirstHeartbeat();

    await firstHeartbeat;

    await heartbeat.runNow();

    expect(heartbeatWorkerMock).toHaveBeenCalledTimes(2);
  });

  it('reports heartbeat failures to the configured callback', async () => {
    const error = new Error('Database unavailable.');
    const onError = vi.fn();

    heartbeatWorkerMock.mockRejectedValue(error);

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      onError,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: vi.fn(),
    });

    await expect(heartbeat.runNow()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('contains failures thrown by the error callback', async () => {
    heartbeatWorkerMock.mockRejectedValue(new Error('Heartbeat failed.'));

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      onError: vi.fn(() => {
        throw new Error('Logging failed.');
      }),
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: vi.fn(),
    });

    await expect(heartbeat.runNow()).resolves.toBeUndefined();
  });

  it('stops the timer and rejects future heartbeat executions', async () => {
    const clearIntervalMock = vi.fn();

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: clearIntervalMock,
    });

    await heartbeat.stop();
    await heartbeat.runNow();

    expect(clearIntervalMock).toHaveBeenCalledOnce();

    expect(clearIntervalMock).toHaveBeenCalledWith('timer-123');

    expect(heartbeatWorkerMock).not.toHaveBeenCalled();
    expect(heartbeat.isRunning()).toBe(false);
  });

  it('supports idempotent stop calls', async () => {
    const clearIntervalMock = vi.fn();

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: clearIntervalMock,
    });

    await heartbeat.stop();
    await heartbeat.stop();

    expect(clearIntervalMock).toHaveBeenCalledOnce();
  });

  it('waits for an active heartbeat before stop completes', async () => {
    let resolveHeartbeat;
    let stopResolved = false;

    heartbeatWorkerMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHeartbeat = resolve;
        }),
    );

    const heartbeat = startHeartbeat({
      workerId: 'worker-123',
      intervalMs: 10_000,
      setIntervalFn: vi.fn(() => 'timer-123'),
      clearIntervalFn: vi.fn(),
    });

    const activeHeartbeat = heartbeat.runNow();

    const stopPromise = heartbeat.stop().then(() => {
      stopResolved = true;
    });

    await Promise.resolve();

    expect(stopResolved).toBe(false);

    resolveHeartbeat();

    await activeHeartbeat;
    await stopPromise;

    expect(stopResolved).toBe(true);
  });

  it('rejects an empty worker identifier during setup', () => {
    expect(() =>
      startHeartbeat({
        workerId: '   ',
        intervalMs: 10_000,
      }),
    ).toThrow('Heartbeat requires a valid workerId.');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid interval value %s', (intervalMs) => {
    expect(() =>
      startHeartbeat({
        workerId: 'worker-123',
        intervalMs,
      }),
    ).toThrow('Heartbeat intervalMs must be a positive integer.');
  });
});
