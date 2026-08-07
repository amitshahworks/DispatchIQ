/**
 * @file worker.js
 * @description Production entrypoint and process-level coordinator for the
 * DispatchIQ background worker.
 *
 * This module connects worker registration, job handlers, job processing,
 * heartbeat persistence, stale-worker recovery, operating-system signals, and
 * Prisma shutdown into one deterministic worker-process lifecycle.
 *
 * Runtime components remain dependency-injected so startup and shutdown
 * behavior can be unit tested without real timers or PostgreSQL connections.
 */

import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dispatchiq/database';

import { jobHandlers } from './handlers/index.js';
import { createJobProcessor } from './jobs/job-processor.js';
import { startRecoveryScheduler } from './recovery/recovery-scheduler.js';
import { createStaleWorkerRecoveryService } from './recovery/stale-worker.service.js';
import { createWorkerRuntime } from './runtime/worker-runtime.js';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60 * 1_000;

const DEFAULT_RECOVERY_INTERVAL_MS = 15_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RECOVERY_BATCH_LIMIT = 100;

/**
 * Writes an informational worker message to standard output.
 *
 * @param {string} message Log message.
 * @returns {void}
 */
function writeInfo(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Writes a worker error message to standard error.
 *
 * @param {string} message Error message.
 * @returns {void}
 */
function writeError(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * Default process logger.
 */
const defaultLogger = Object.freeze({
  info: writeInfo,
  error: writeError,
});

/**
 * Parses a positive integer environment value.
 *
 * @param {string | undefined} rawValue Raw environment value.
 * @param {number} fallback Fallback value when configuration is omitted.
 * @param {string} variableName Environment variable name.
 * @returns {number} Validated positive integer.
 * @throws {Error} When the supplied value is invalid.
 */
function parsePositiveInteger(rawValue, fallback, variableName) {
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsedValue;
}

/**
 * Reads and validates DispatchIQ worker-process configuration.
 *
 * Recovery and heartbeat timings are validated together because the stale
 * threshold must exceed the normal heartbeat interval. Otherwise a healthy
 * worker could be incorrectly classified as stale between heartbeats.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [source=process.env]
 * Environment source.
 * @param {string} [defaultHostname=os.hostname()] Hostname fallback.
 * @returns {Readonly<{
 *   hostname: string,
 *   pollIntervalMs: number,
 *   heartbeatIntervalMs: number,
 *   retryBaseDelayMs: number,
 *   retryMaxDelayMs: number,
 *   recoveryIntervalMs: number,
 *   staleAfterMs: number,
 *   recoveryBatchLimit: number
 * }>} Immutable worker configuration.
 */
export function readWorkerConfig(source = process.env, defaultHostname = os.hostname()) {
  const hostname = source.WORKER_HOSTNAME?.trim() || defaultHostname.trim();

  if (!hostname) {
    throw new Error('Worker hostname cannot be empty.');
  }

  const pollIntervalMs = parsePositiveInteger(
    source.WORKER_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    'WORKER_POLL_INTERVAL_MS',
  );

  const heartbeatIntervalMs = parsePositiveInteger(
    source.WORKER_HEARTBEAT_INTERVAL_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    'WORKER_HEARTBEAT_INTERVAL_MS',
  );

  const retryBaseDelayMs = parsePositiveInteger(
    source.WORKER_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_BASE_DELAY_MS,
    'WORKER_RETRY_BASE_DELAY_MS',
  );

  const retryMaxDelayMs = parsePositiveInteger(
    source.WORKER_RETRY_MAX_DELAY_MS,
    DEFAULT_RETRY_MAX_DELAY_MS,
    'WORKER_RETRY_MAX_DELAY_MS',
  );

  const recoveryIntervalMs = parsePositiveInteger(
    source.WORKER_RECOVERY_INTERVAL_MS,
    DEFAULT_RECOVERY_INTERVAL_MS,
    'WORKER_RECOVERY_INTERVAL_MS',
  );

  const staleAfterMs = parsePositiveInteger(
    source.WORKER_STALE_AFTER_MS,
    DEFAULT_STALE_AFTER_MS,
    'WORKER_STALE_AFTER_MS',
  );

  const recoveryBatchLimit = parsePositiveInteger(
    source.WORKER_RECOVERY_BATCH_LIMIT,
    DEFAULT_RECOVERY_BATCH_LIMIT,
    'WORKER_RECOVERY_BATCH_LIMIT',
  );

  if (retryMaxDelayMs < retryBaseDelayMs) {
    throw new Error('WORKER_RETRY_MAX_DELAY_MS cannot be lower than WORKER_RETRY_BASE_DELAY_MS.');
  }

  if (staleAfterMs <= heartbeatIntervalMs) {
    throw new Error('WORKER_STALE_AFTER_MS must be greater than WORKER_HEARTBEAT_INTERVAL_MS.');
  }

  return Object.freeze({
    hostname,
    pollIntervalMs,
    heartbeatIntervalMs,
    retryBaseDelayMs,
    retryMaxDelayMs,
    recoveryIntervalMs,
    staleAfterMs,
    recoveryBatchLimit,
  });
}

/**
 * Converts an unknown failure into a safe log message.
 *
 * @param {unknown} error Unknown failure.
 * @returns {string} Loggable message.
 */
function getErrorMessage(error) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  return 'Unknown worker error.';
}

/**
 * Creates the DispatchIQ worker-process coordinator.
 *
 * Startup sequence:
 *
 * 1. Construct the worker runtime.
 * 2. Register and start the worker.
 * 3. Create the worker-specific job processor.
 * 4. Create stale-worker recovery business logic.
 * 5. Start automatic stale-worker recovery scheduling.
 * 6. Register graceful operating-system signal handlers.
 *
 * Shutdown reverses runtime ownership safely: recovery scheduling stops before
 * worker polling/heartbeat shutdown and Prisma disconnection.
 *
 * @param {{
 *   config?: ReturnType<typeof readWorkerConfig>,
 *   handlers?: Record<string, (job: object) => Promise<unknown>>,
 *   runtimeFactory?: typeof createWorkerRuntime,
 *   processorFactory?: typeof createJobProcessor,
 *   recoveryServiceFactory?: typeof createStaleWorkerRecoveryService,
 *   recoverySchedulerFactory?: typeof startRecoveryScheduler,
 *   databaseClient?: { $disconnect: () => Promise<void> },
 *   processRef?: Pick<NodeJS.Process, 'once' | 'removeListener'>,
 *   logger?: {
 *     info: (message: string) => void,
 *     error: (message: string) => void
 *   }
 * }} [options] Worker-process dependencies.
 * @returns {{
 *   start: () => Promise<object>,
 *   shutdown: (signal?: string) => Promise<void>,
 *   getRuntime: () => ReturnType<typeof createWorkerRuntime> | null,
 *   getRecoveryScheduler: () => ReturnType<typeof startRecoveryScheduler> | null,
 *   isStarted: () => boolean,
 *   isShuttingDown: () => boolean
 * }} Worker-process controller.
 */
export function createWorkerProcess({
  config = readWorkerConfig(),
  handlers = jobHandlers,
  runtimeFactory = createWorkerRuntime,
  processorFactory = createJobProcessor,
  recoveryServiceFactory = createStaleWorkerRecoveryService,
  recoverySchedulerFactory = startRecoveryScheduler,
  databaseClient = prisma,
  processRef = process,
  logger = defaultLogger,
} = {}) {
  let runtime = null;
  let recoveryScheduler = null;
  let processClaim = null;
  let worker = null;

  let started = false;
  let shuttingDown = false;
  let shutdownPromise = null;
  let signalHandlersRegistered = false;

  /**
   * Reports runtime errors without throwing back into timers.
   *
   * @param {unknown} error Runtime failure.
   * @returns {void}
   */
  function reportRuntimeError(error) {
    logger.error(`[DispatchIQ Worker] ${getErrorMessage(error)}`);
  }

  /**
   * Reports meaningful recovery activity.
   *
   * Empty recovery scans remain silent to avoid producing repetitive logs
   * during healthy operation.
   *
   * @param {{
   *   workersRecovered?: number,
   *   jobsRecovered?: number,
   *   failures?: Array<object>
   * }} summary Recovery summary.
   * @returns {void}
   */
  function reportRecoverySummary(summary) {
    const workersRecovered = summary?.workersRecovered ?? 0;

    const jobsRecovered = summary?.jobsRecovered ?? 0;

    const failures = summary?.failures?.length ?? 0;

    if (workersRecovered === 0 && jobsRecovered === 0 && failures === 0) {
      return;
    }

    logger.info(
      `[DispatchIQ Worker] Recovery cycle completed: ${workersRecovered} worker(s), ${jobsRecovered} job(s), ${failures} failure(s).`,
    );
  }

  /**
   * Handles process termination through graceful shutdown.
   *
   * @param {string} signal Operating-system signal.
   * @returns {void}
   */
  function handleSignal(signal) {
    void shutdown(signal).catch((error) => {
      logger.error(`[DispatchIQ Worker] Graceful shutdown failed: ${getErrorMessage(error)}`);
    });
  }

  const sigintHandler = () => {
    handleSignal('SIGINT');
  };

  const sigtermHandler = () => {
    handleSignal('SIGTERM');
  };

  /**
   * Registers process signal handlers once.
   *
   * @returns {void}
   */
  function registerSignalHandlers() {
    if (signalHandlersRegistered) {
      return;
    }

    processRef.once('SIGINT', sigintHandler);
    processRef.once('SIGTERM', sigtermHandler);

    signalHandlersRegistered = true;
  }

  /**
   * Removes registered process signal handlers.
   *
   * @returns {void}
   */
  function removeSignalHandlers() {
    if (!signalHandlersRegistered) {
      return;
    }

    processRef.removeListener('SIGINT', sigintHandler);

    processRef.removeListener('SIGTERM', sigtermHandler);

    signalHandlersRegistered = false;
  }

  /**
   * Best-effort cleanup when startup fails after partially initializing
   * process resources.
   *
   * @returns {Promise<void>}
   */
  async function rollbackStartup() {
    if (recoveryScheduler) {
      try {
        await recoveryScheduler.stop();
      } catch {
        // Preserve the original startup failure.
      }
    }

    if (runtime) {
      try {
        await runtime.stop();
      } catch {
        // Preserve the original startup failure.
      }
    }

    removeSignalHandlers();

    recoveryScheduler = null;
    runtime = null;
    processClaim = null;
    worker = null;
    started = false;
  }

  /**
   * Starts the complete worker process.
   *
   * @returns {Promise<object>} Registered worker instance.
   */
  async function start() {
    if (started && worker) {
      return worker;
    }

    if (shuttingDown) {
      throw new Error('Worker process cannot start while shutting down.');
    }

    runtime = runtimeFactory({
      hostname: config.hostname,
      pollIntervalMs: config.pollIntervalMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,

      /*
       * Runtime construction occurs before worker registration, while the job
       * processor requires the resulting persistent worker ID. This deferred
       * delegate bridges that startup dependency safely.
       */
      processClaim: async (claim) => {
        if (!processClaim) {
          throw new Error('Worker job processor is not initialized.');
        }

        await processClaim(claim);
      },

      onError: reportRuntimeError,
    });

    try {
      worker = await runtime.start();

      processClaim = processorFactory({
        workerId: worker.id,
        handlers,
        retryBaseDelayMs: config.retryBaseDelayMs,
        retryMaxDelayMs: config.retryMaxDelayMs,
      });

      const recoveryService = recoveryServiceFactory({
        staleAfterMs: config.staleAfterMs,
        retryBaseDelayMs: config.retryBaseDelayMs,
        retryMaxDelayMs: config.retryMaxDelayMs,
        staleWorkerLimit: config.recoveryBatchLimit,
      });

      recoveryScheduler = recoverySchedulerFactory({
        intervalMs: config.recoveryIntervalMs,

        recoverAllWorkers: recoveryService.recoverAllWorkers,

        onError: reportRuntimeError,
        onRecovery: reportRecoverySummary,
      });

      registerSignalHandlers();

      started = true;

      logger.info(`[DispatchIQ Worker] Online as ${worker.id} on ${config.hostname}.`);

      return worker;
    } catch (error) {
      await rollbackStartup();

      throw error;
    }
  }

  /**
   * Gracefully shuts down the worker process.
   *
   * Shutdown ordering matters:
   *
   * 1. Stop stale-worker recovery so no new recovery transaction starts.
   * 2. Stop worker polling and heartbeat activity.
   * 3. Allow runtime-owned active work to settle.
   * 4. Disconnect Prisma only after database-using components have stopped.
   *
   * Concurrent shutdown requests share one promise.
   *
   * @param {string} [signal='MANUAL'] Shutdown source.
   * @returns {Promise<void>}
   */
  function shutdown(signal = 'MANUAL') {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      shuttingDown = true;

      removeSignalHandlers();

      logger.info(`[DispatchIQ Worker] Shutdown requested by ${signal}.`);

      let shutdownError = null;

      if (recoveryScheduler) {
        try {
          await recoveryScheduler.stop();
        } catch (error) {
          shutdownError ??= error;
        }
      }

      if (runtime && started) {
        try {
          await runtime.stop();
        } catch (error) {
          shutdownError ??= error;
        }
      }

      try {
        await databaseClient.$disconnect();
      } catch (error) {
        shutdownError ??= error;
      }

      started = false;

      if (shutdownError) {
        throw shutdownError;
      }

      logger.info('[DispatchIQ Worker] Shutdown complete.');
    })();

    return shutdownPromise;
  }

  return {
    start,
    shutdown,

    getRuntime: () => runtime,

    getRecoveryScheduler: () => recoveryScheduler,

    isStarted: () => started,

    isShuttingDown: () => shuttingDown,
  };
}

/**
 * Starts the production worker process.
 *
 * Fatal startup failures set the process exit code after attempting to
 * disconnect Prisma.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  const workerProcess = createWorkerProcess();

  try {
    await workerProcess.start();
  } catch (error) {
    defaultLogger.error(`[DispatchIQ Worker] Startup failed: ${getErrorMessage(error)}`);

    try {
      await prisma.$disconnect();
    } catch {
      // Preserve the original startup failure.
    }

    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  await main();
}
