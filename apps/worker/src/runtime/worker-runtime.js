/**
 * @file worker-runtime.js
 * @description Coordinates the lifecycle of a DispatchIQ worker process.
 *
 * The runtime registers a worker instance, starts heartbeat persistence,
 * polls PostgreSQL for claimable jobs, tracks ONLINE/BUSY lifecycle state,
 * delegates claimed-job execution to a processor, and performs graceful
 * shutdown without accepting new work.
 */

import { claimNextJob } from '../jobs/worker.repository.js';
import {
  setWorkerAvailable,
  setWorkerBusy,
  startWorkerInstance,
  stopWorkerInstance,
} from '../worker-instance/worker-instance.service.js';
import { startHeartbeat } from './heartbeat.js';

/**
 * Creates a worker runtime coordinator.
 *
 * Job execution is delegated through `processClaim`. This keeps the runtime
 * independent from individual EMAIL, WEBHOOK, and REPORT_GENERATION handlers.
 * The processor will later coordinate successful completion, retry scheduling,
 * and dead-letter transitions.
 *
 * @param {{
 *   hostname: string,
 *   pollIntervalMs: number,
 *   heartbeatIntervalMs: number,
 *   processClaim: (claim: { job: object, attempt: object }) => Promise<void>,
 *   onError?: (error: unknown) => void | Promise<void>,
 *   now?: () => Date,
 *   setIntervalFn?: typeof setInterval,
 *   clearIntervalFn?: typeof clearInterval
 * }} options Worker runtime configuration.
 * @returns {{
 *   start: () => Promise<object>,
 *   pollNow: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   isRunning: () => boolean,
 *   isStopping: () => boolean,
 *   getWorkerId: () => string | null
 * }} Worker runtime controller.
 */
export function createWorkerRuntime({
  hostname,
  pollIntervalMs,
  heartbeatIntervalMs,
  processClaim,
  onError = () => {},
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  if (typeof hostname !== 'string' || hostname.trim().length === 0) {
    throw new Error('Worker runtime requires a valid hostname.');
  }

  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error('Worker pollIntervalMs must be a positive integer.');
  }

  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new Error('Worker heartbeatIntervalMs must be a positive integer.');
  }

  if (typeof processClaim !== 'function') {
    throw new Error('Worker runtime requires a processClaim function.');
  }

  let worker = null;
  let pollingTimer = null;
  let heartbeat = null;

  let started = false;
  let stopping = false;
  let stopped = false;

  let activePoll = null;
  let activeExecution = null;

  /**
   * Reports runtime errors without allowing an error callback failure to
   * create an unhandled rejection.
   *
   * @param {unknown} error Runtime error.
   * @returns {Promise<void>}
   */
  async function reportError(error) {
    try {
      await onError(error);
    } catch {
      // Runtime error reporting must never destabilize the polling loop.
    }
  }

  /**
   * Executes one polling cycle.
   *
   * Overlapping polling cycles are skipped. Once shutdown begins, no new jobs
   * are claimed. A claimed job moves the worker from ONLINE to BUSY and is
   * delegated to the configured processor.
   *
   * @returns {Promise<void>}
   */
  async function pollNow() {
    if (!started || stopping || stopped || !worker || activePoll) {
      return;
    }

    activePoll = (async () => {
      try {
        const claim = await claimNextJob({
          workerId: worker.id,
          claimedAt: now(),
        });

        if (!claim || stopping) {
          return;
        }

        await setWorkerBusy({
          workerId: worker.id,
          busyAt: now(),
        });

        activeExecution = (async () => {
          try {
            await processClaim(claim);
          } catch (error) {
            await reportError(error);
          } finally {
            activeExecution = null;

            /*
             * During normal operation, completed processing returns the worker
             * to ONLINE. During shutdown, BUSY transitions directly to
             * STOPPING after the active execution settles.
             */
            if (!stopping && !stopped) {
              try {
                await setWorkerAvailable({
                  workerId: worker.id,
                  onlineAt: now(),
                });
              } catch (error) {
                await reportError(error);
              }
            }
          }
        })();

        await activeExecution;
      } catch (error) {
        await reportError(error);
      } finally {
        activePoll = null;
      }
    })();

    await activePoll;
  }

  /**
   * Starts the worker lifecycle, heartbeat scheduler, and polling timer.
   *
   * Calling start more than once returns the existing worker record without
   * registering a duplicate process.
   *
   * @returns {Promise<object>} Registered ONLINE worker instance.
   */
  async function start() {
    if (started && worker) {
      return worker;
    }

    if (stopping || stopped) {
      throw new Error('A stopped worker runtime cannot be started again.');
    }

    const startedAt = now();

    worker = await startWorkerInstance({
      hostname: hostname.trim(),
      startedAt,
      onlineAt: startedAt,
    });

    heartbeat = startHeartbeat({
      workerId: worker.id,
      intervalMs: heartbeatIntervalMs,
      now,
      setIntervalFn,
      clearIntervalFn,
      onError: reportError,
    });

    pollingTimer = setIntervalFn(() => {
      void pollNow();
    }, pollIntervalMs);

    started = true;

    return worker;
  }

  /**
   * Gracefully stops the worker.
   *
   * Shutdown stops future polling and heartbeat ticks, waits for in-flight
   * polling and execution work, then persists STOPPING and OFFLINE states.
   * Calling stop repeatedly is safe.
   *
   * @returns {Promise<void>}
   */
  async function stop() {
    if (stopped) {
      return;
    }

    if (!started || !worker) {
      stopped = true;
      return;
    }

    stopping = true;

    if (pollingTimer !== null) {
      clearIntervalFn(pollingTimer);
      pollingTimer = null;
    }

    if (heartbeat) {
      await heartbeat.stop();
    }

    if (activePoll) {
      await activePoll;
    } else if (activeExecution) {
      await activeExecution;
    }

    const stoppedAt = now();

    await stopWorkerInstance({
      workerId: worker.id,
      stoppingAt: stoppedAt,
      stoppedAt,
    });

    stopped = true;
    started = false;
  }

  /**
   * Reports whether the runtime is active and accepting polling work.
   *
   * @returns {boolean}
   */
  function isRunning() {
    return started && !stopping && !stopped;
  }

  /**
   * Reports whether graceful shutdown has started.
   *
   * @returns {boolean}
   */
  function isStopping() {
    return stopping && !stopped;
  }

  /**
   * Returns the persistent worker-instance identifier after startup.
   *
   * @returns {string | null}
   */
  function getWorkerId() {
    return worker?.id ?? null;
  }

  return {
    start,
    pollNow,
    stop,
    isRunning,
    isStopping,
    getWorkerId,
  };
}
