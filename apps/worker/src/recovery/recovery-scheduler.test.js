/**
 * @file recovery-scheduler.test.js
 * @description Unit tests for the DispatchIQ stale-worker recovery scheduler.
 *
 * These tests verify recurring execution, overlap prevention, recovery-summary
 * reporting, failure containment, scheduler state, and graceful shutdown
 * without relying on real timers or PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startRecoveryScheduler } from './recovery-scheduler.js';

const EMPTY_SUMMARY = Object.freeze({
  workersRecovered: 0,
  jobsRecovered: 0,
  jobsRetried: 0,
  jobsDeadLettered: 0,
  failures: [],
});

/**
 * Creates a recovery scheduler using deterministic timer mocks.
 *
 * @param {object} overrides Scheduler overrides.
 * @returns {{
 *   scheduler: ReturnType<typeof startRecoveryScheduler>,
 *   recoverAllWorkers: ReturnType<typeof vi.fn>,
 *   onError: ReturnType<typeof vi.fn>,
 *   onRecovery: ReturnType<typeof vi.fn>,
 *   setIntervalFn: ReturnType<typeof vi.fn>,
 *   clearIntervalFn: ReturnType<typeof vi.fn>
 * }}
 */
function createScheduler(overrides = {}) {
  const recoverAllWorkers = vi.fn().mockResolvedValue(EMPTY_SUMMARY);

  const onError = vi.fn();
  const onRecovery = vi.fn();

  const setIntervalFn = vi.fn(() => 'recovery-timer');
  const clearIntervalFn = vi.fn();

  const scheduler = startRecoveryScheduler({
    intervalMs: 15_000,
    recoverAllWorkers,
    onError,
    onRecovery,
    setIntervalFn,
    clearIntervalFn,
    ...overrides,
  });

  return {
    scheduler,
    recoverAllWorkers,
    onError,
    onRecovery,
    setIntervalFn,
    clearIntervalFn,
  };
}

describe('recovery scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startup', () => {
    it('starts a recurring timer using the configured interval', () => {
      const { scheduler, setIntervalFn } = createScheduler();

      expect(setIntervalFn).toHaveBeenCalledOnce();

      expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15_000);

      expect(scheduler.isRunning()).toBe(true);
      expect(scheduler.isRecovering()).toBe(false);
    });

    it('executes recovery when the timer callback fires', async () => {
      let timerCallback;

      const setIntervalFn = vi.fn((callback) => {
        timerCallback = callback;

        return 'recovery-timer';
      });

      const recoverAllWorkers = vi.fn().mockResolvedValue(EMPTY_SUMMARY);

      startRecoveryScheduler({
        intervalMs: 15_000,
        recoverAllWorkers,
        setIntervalFn,
      });

      timerCallback();

      await vi.waitFor(() => {
        expect(recoverAllWorkers).toHaveBeenCalledOnce();
      });
    });
  });

  describe('runNow', () => {
    it('executes recovery immediately and returns its summary', async () => {
      const summary = {
        workersRecovered: 2,
        jobsRecovered: 4,
        jobsRetried: 3,
        jobsDeadLettered: 1,
        failures: [],
      };

      const recoverAllWorkers = vi.fn().mockResolvedValue(summary);

      const { scheduler } = createScheduler({
        recoverAllWorkers,
      });

      await expect(scheduler.runNow()).resolves.toEqual(summary);

      expect(recoverAllWorkers).toHaveBeenCalledOnce();
    });

    it('reports successful recovery summaries through onRecovery', async () => {
      const summary = {
        workersRecovered: 1,
        jobsRecovered: 2,
        jobsRetried: 1,
        jobsDeadLettered: 1,
        failures: [],
      };

      const recoverAllWorkers = vi.fn().mockResolvedValue(summary);

      const onRecovery = vi.fn();

      const { scheduler } = createScheduler({
        recoverAllWorkers,
        onRecovery,
      });

      await scheduler.runNow();

      expect(onRecovery).toHaveBeenCalledOnce();
      expect(onRecovery).toHaveBeenCalledWith(summary);
    });

    it('prevents overlapping recovery cycles', async () => {
      let resolveFirstRecovery;

      const recoverAllWorkers = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstRecovery = resolve;
            }),
        )
        .mockResolvedValueOnce(EMPTY_SUMMARY);

      const { scheduler } = createScheduler({
        recoverAllWorkers,
      });

      const firstRecovery = scheduler.runNow();

      expect(scheduler.isRecovering()).toBe(true);

      const overlappingRecovery = await scheduler.runNow();

      expect(overlappingRecovery).toBeUndefined();

      expect(recoverAllWorkers).toHaveBeenCalledTimes(1);

      resolveFirstRecovery(EMPTY_SUMMARY);

      await firstRecovery;

      expect(scheduler.isRecovering()).toBe(false);

      await scheduler.runNow();

      expect(recoverAllWorkers).toHaveBeenCalledTimes(2);
    });

    it('contains recovery-service failures and reports them', async () => {
      const error = new Error('Recovery database unavailable.');

      const recoverAllWorkers = vi.fn().mockRejectedValue(error);

      const onError = vi.fn();

      const { scheduler } = createScheduler({
        recoverAllWorkers,
        onError,
      });

      await expect(scheduler.runNow()).resolves.toBeUndefined();

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(error);

      expect(scheduler.isRunning()).toBe(true);
      expect(scheduler.isRecovering()).toBe(false);
    });

    it('contains failures thrown by the error callback', async () => {
      const recoverAllWorkers = vi.fn().mockRejectedValue(new Error('Recovery failed.'));

      const { scheduler } = createScheduler({
        recoverAllWorkers,
        onError: vi.fn(() => {
          throw new Error('Logging failed.');
        }),
      });

      await expect(scheduler.runNow()).resolves.toBeUndefined();

      expect(scheduler.isRunning()).toBe(true);
    });

    it('reports onRecovery callback failures without failing recovery', async () => {
      const summary = {
        workersRecovered: 1,
        jobsRecovered: 0,
        jobsRetried: 0,
        jobsDeadLettered: 0,
        failures: [],
      };

      const recoveryCallbackError = new Error('Recovery metrics unavailable.');

      const onError = vi.fn();

      const { scheduler } = createScheduler({
        recoverAllWorkers: vi.fn().mockResolvedValue(summary),
        onRecovery: vi.fn().mockRejectedValue(recoveryCallbackError),
        onError,
      });

      await expect(scheduler.runNow()).resolves.toEqual(summary);

      expect(onError).toHaveBeenCalledWith(recoveryCallbackError);
    });

    it('does not execute recovery after shutdown', async () => {
      const { scheduler, recoverAllWorkers } = createScheduler();

      await scheduler.stop();
      await scheduler.runNow();

      expect(recoverAllWorkers).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('clears the recurring timer', async () => {
      const { scheduler, clearIntervalFn } = createScheduler();

      await scheduler.stop();

      expect(clearIntervalFn).toHaveBeenCalledOnce();

      expect(clearIntervalFn).toHaveBeenCalledWith('recovery-timer');

      expect(scheduler.isRunning()).toBe(false);
    });

    it('supports idempotent stop calls', async () => {
      const { scheduler, clearIntervalFn } = createScheduler();

      await scheduler.stop();
      await scheduler.stop();

      expect(clearIntervalFn).toHaveBeenCalledOnce();
    });

    it('waits for an active recovery cycle before shutdown completes', async () => {
      let resolveRecovery;
      let shutdownResolved = false;

      const recoverAllWorkers = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRecovery = resolve;
          }),
      );

      const { scheduler } = createScheduler({
        recoverAllWorkers,
      });

      const recovery = scheduler.runNow();

      expect(scheduler.isRecovering()).toBe(true);

      const shutdown = scheduler.stop().then(() => {
        shutdownResolved = true;
      });

      await Promise.resolve();

      expect(shutdownResolved).toBe(false);
      expect(scheduler.isRunning()).toBe(false);

      resolveRecovery(EMPTY_SUMMARY);

      await recovery;
      await shutdown;

      expect(shutdownResolved).toBe(true);
      expect(scheduler.isRecovering()).toBe(false);
    });

    it('rejects timer-triggered recovery once shutdown has started', async () => {
      let timerCallback;

      const recoverAllWorkers = vi.fn();

      const scheduler = startRecoveryScheduler({
        intervalMs: 15_000,
        recoverAllWorkers,
        setIntervalFn: vi.fn((callback) => {
          timerCallback = callback;

          return 'recovery-timer';
        }),
        clearIntervalFn: vi.fn(),
      });

      await scheduler.stop();

      timerCallback();

      await Promise.resolve();

      expect(recoverAllWorkers).not.toHaveBeenCalled();
    });
  });

  describe('configuration validation', () => {
    it.each([0, -1, 1.5, Number.NaN])('rejects invalid scheduler interval %s', (intervalMs) => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs,
          recoverAllWorkers: vi.fn(),
        }),
      ).toThrow('Recovery scheduler intervalMs must be a positive integer.');
    });

    it('rejects a missing recovery operation', () => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs: 15_000,
        }),
      ).toThrow('Recovery scheduler requires a recoverAllWorkers function.');
    });

    it('rejects an invalid error callback', () => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs: 15_000,
          recoverAllWorkers: vi.fn(),
          onError: null,
        }),
      ).toThrow('Recovery scheduler onError must be a function.');
    });

    it('rejects an invalid recovery callback', () => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs: 15_000,
          recoverAllWorkers: vi.fn(),
          onRecovery: null,
        }),
      ).toThrow('Recovery scheduler onRecovery must be a function.');
    });

    it('rejects an invalid timer dependency', () => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs: 15_000,
          recoverAllWorkers: vi.fn(),
          setIntervalFn: null,
        }),
      ).toThrow('Recovery scheduler requires a setInterval function.');
    });

    it('rejects an invalid timer cleanup dependency', () => {
      expect(() =>
        startRecoveryScheduler({
          intervalMs: 15_000,
          recoverAllWorkers: vi.fn(),
          clearIntervalFn: null,
        }),
      ).toThrow('Recovery scheduler requires a clearInterval function.');
    });
  });
});
