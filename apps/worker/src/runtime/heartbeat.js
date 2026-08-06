/**
 * @file heartbeat.js
 * @description Recurring heartbeat scheduler for a running DispatchIQ worker.
 *
 * The scheduler periodically persists worker liveness through the
 * worker-instance service. It prevents overlapping heartbeat writes, supports
 * graceful shutdown, and reports heartbeat failures to the runtime through a
 * caller-provided callback.
 */

import { heartbeatWorker } from '../worker-instance/worker-instance.service.js';

/**
 * Starts a recurring heartbeat scheduler for one worker instance.
 *
 * Only one heartbeat request may run at a time. If a heartbeat takes longer
 * than the configured interval, subsequent timer ticks are skipped until the
 * in-flight operation finishes.
 *
 * The returned controller stops future heartbeats and waits for any active
 * heartbeat to settle, which allows graceful worker shutdown.
 *
 * @param {{
 *   workerId: string,
 *   intervalMs: number,
 *   onError?: (error: unknown) => void | Promise<void>,
 *   now?: () => Date,
 *   setIntervalFn?: typeof setInterval,
 *   clearIntervalFn?: typeof clearInterval
 * }} options Heartbeat runtime configuration.
 * @returns {{
 *   stop: () => Promise<void>,
 *   runNow: () => Promise<void>,
 *   isRunning: () => boolean
 * }} Heartbeat runtime controller.
 * @throws {Error} When required configuration is invalid.
 */
export function startHeartbeat({
  workerId,
  intervalMs,
  onError = () => {},
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (typeof workerId !== 'string' || workerId.trim().length === 0) {
    throw new Error('Heartbeat requires a valid workerId.');
  }

  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Heartbeat intervalMs must be a positive integer.');
  }

  let stopped = false;
  let activeHeartbeat = null;

  /**
   * Executes one heartbeat while preventing concurrent writes.
   *
   * @returns {Promise<void>}
   */
  async function runNow() {
    if (stopped || activeHeartbeat) {
      return;
    }

    activeHeartbeat = (async () => {
      try {
        await heartbeatWorker({
          workerId,
          heartbeatAt: now(),
        });
      } catch (error) {
        try {
          await onError(error);
        } catch {
          // Error reporting must not create an unhandled rejection or prevent
          // the heartbeat operation from settling.
        }
      } finally {
        activeHeartbeat = null;
      }
    })();

    await activeHeartbeat;
  }

  const timer = setIntervalFn(() => {
    void runNow();
  }, intervalMs);

  /**
   * Stops future heartbeats and waits for any active heartbeat to settle.
   *
   * Calling stop more than once is safe.
   *
   * @returns {Promise<void>}
   */
  async function stop() {
    if (!stopped) {
      stopped = true;
      clearIntervalFn(timer);
    }

    if (activeHeartbeat) {
      await activeHeartbeat;
    }
  }

  /**
   * Reports whether the scheduler still accepts heartbeat executions.
   *
   * @returns {boolean}
   */
  function isRunning() {
    return !stopped;
  }

  return {
    stop,
    runNow,
    isRunning,
  };
}
