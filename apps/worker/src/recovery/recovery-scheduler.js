/**
 * @file recovery-scheduler.js
 * @description Periodic stale-worker recovery scheduler for DispatchIQ.
 *
 * The scheduler invokes the stale-worker recovery service at a fixed interval,
 * prevents overlapping recovery runs, reports recovery failures without
 * crashing the worker process, and supports graceful shutdown by waiting for
 * any active recovery cycle to finish.
 *
 * Database and recovery business logic remain outside this module. The
 * scheduler depends only on a callable recovery operation, which keeps runtime
 * orchestration independently testable.
 */

/**
 * Starts the stale-worker recovery scheduler.
 *
 * A recovery cycle may involve multiple stale workers and abandoned jobs, so a
 * cycle can occasionally take longer than the configured interval. When that
 * happens, subsequent timer ticks are skipped until the active cycle settles.
 *
 * The returned controller allows callers to trigger recovery immediately,
 * inspect scheduler state, and stop cleanly during worker shutdown.
 *
 * @param {{
 *   intervalMs: number,
 *   recoverAllWorkers: () => Promise<{
 *     workersRecovered: number,
 *     jobsRecovered: number,
 *     jobsRetried: number,
 *     jobsDeadLettered: number,
 *     failures: Array<object>
 *   }>,
 *   onError?: (error: unknown) => void | Promise<void>,
 *   onRecovery?: (summary: object) => void | Promise<void>,
 *   setIntervalFn?: typeof setInterval,
 *   clearIntervalFn?: typeof clearInterval
 * }} options Scheduler configuration.
 * @returns {{
 *   runNow: () => Promise<object | undefined>,
 *   stop: () => Promise<void>,
 *   isRunning: () => boolean,
 *   isRecovering: () => boolean
 * }} Recovery scheduler controller.
 * @throws {Error} When required configuration is invalid.
 */
export function startRecoveryScheduler({
  intervalMs,
  recoverAllWorkers,
  onError = () => {},
  onRecovery = () => {},
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Recovery scheduler intervalMs must be a positive integer.');
  }

  if (typeof recoverAllWorkers !== 'function') {
    throw new Error('Recovery scheduler requires a recoverAllWorkers function.');
  }

  if (typeof onError !== 'function') {
    throw new Error('Recovery scheduler onError must be a function.');
  }

  if (typeof onRecovery !== 'function') {
    throw new Error('Recovery scheduler onRecovery must be a function.');
  }

  if (typeof setIntervalFn !== 'function') {
    throw new Error('Recovery scheduler requires a setInterval function.');
  }

  if (typeof clearIntervalFn !== 'function') {
    throw new Error('Recovery scheduler requires a clearInterval function.');
  }

  let stopped = false;
  let activeRecovery = null;

  /**
   * Reports scheduler failures without allowing the reporting mechanism itself
   * to create an unhandled rejection.
   *
   * @param {unknown} error Recovery or callback error.
   * @returns {Promise<void>}
   */
  async function reportError(error) {
    try {
      await onError(error);
    } catch {
      /*
       * Error reporting is intentionally contained. A logging or telemetry
       * failure must never destabilize the recovery scheduler.
       */
    }
  }

  /**
   * Executes one recovery cycle.
   *
   * Calls made while recovery is already active are ignored. This guarantees
   * that one scheduler instance never launches competing stale-worker scans.
   *
   * Recovery-service failures are reported and contained so the interval can
   * continue operating on future ticks.
   *
   * @returns {Promise<object | undefined>} Recovery summary, or undefined when
   * execution is skipped or recovery fails.
   */
  async function runNow() {
    if (stopped || activeRecovery) {
      return undefined;
    }

    activeRecovery = (async () => {
      try {
        const summary = await recoverAllWorkers();

        try {
          await onRecovery(summary);
        } catch (error) {
          await reportError(error);
        }

        return summary;
      } catch (error) {
        await reportError(error);

        return undefined;
      } finally {
        activeRecovery = null;
      }
    })();

    return activeRecovery;
  }

  const timer = setIntervalFn(() => {
    void runNow();
  }, intervalMs);

  /**
   * Stops future recovery cycles and waits for any active cycle to settle.
   *
   * Repeated stop calls are safe and clear the scheduler timer only once.
   *
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!stopped) {
      stopped = true;
      clearIntervalFn(timer);
    }

    if (activeRecovery) {
      await activeRecovery;
    }
  }

  /**
   * Reports whether this scheduler still accepts recovery executions.
   *
   * @returns {boolean}
   */
  function isRunning() {
    return !stopped;
  }

  /**
   * Reports whether a recovery cycle is currently in progress.
   *
   * @returns {boolean}
   */
  function isRecovering() {
    return activeRecovery !== null;
  }

  return {
    runNow,
    stop,
    isRunning,
    isRecovering,
  };
}
