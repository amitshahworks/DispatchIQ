/**
 * @file worker.js
 * @description Production entrypoint and process-level coordinator for the
 * DispatchIQ background worker.
 *
 * This module connects the handler registry, claimed-job processor, worker
 * runtime, operating-system signals, and Prisma shutdown. Runtime construction
 * is dependency-injected so process behavior can be tested without starting
 * real timers or connecting to PostgreSQL.
 */

import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dispatchiq/database';

import { jobHandlers } from './handlers/index.js';
import { createJobProcessor } from './jobs/job-processor.js';
import { createWorkerRuntime } from './runtime/worker-runtime.js';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60 * 1_000;

/**
 * Writes an informational worker message to standard output.
 *
 * A small logger abstraction keeps process coordination independent from a
 * specific logging library and can later be replaced with structured logging.
 *
 * @param {string} message Log message.
 * @returns {void}
 */
function writeInfo(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Writes a worker error to standard error.
 *
 * @param {string} message Error message.
 * @returns {void}
 */
function writeError(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * Default worker logger.
 */
const defaultLogger = Object.freeze({
  info: writeInfo,
  error: writeError,
});

/**
 * Parses a positive integer environment value.
 *
 * @param {string | undefined} rawValue Raw environment value.
 * @param {number} fallback Fallback used when the value is missing.
 * @param {string} variableName Environment variable name.
 * @returns {number} Parsed positive integer.
 * @throws {Error} When the supplied value is not a positive integer.
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
 * Reads and validates worker runtime configuration.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [source=process.env]
 * Environment source.
 * @param {string} [defaultHostname=os.hostname()] Hostname fallback.
 * @returns {Readonly<{
 *   hostname: string,
 *   pollIntervalMs: number,
 *   heartbeatIntervalMs: number,
 *   retryBaseDelayMs: number,
 *   retryMaxDelayMs: number
 * }>} Immutable worker configuration.
 * @throws {Error} When configuration is invalid.
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

  if (retryMaxDelayMs < retryBaseDelayMs) {
    throw new Error('WORKER_RETRY_MAX_DELAY_MS cannot be lower than WORKER_RETRY_BASE_DELAY_MS.');
  }

  return Object.freeze({
    hostname,
    pollIntervalMs,
    heartbeatIntervalMs,
    retryBaseDelayMs,
    retryMaxDelayMs,
  });
}

/**
 * Converts an unknown failure into a loggable message.
 *
 * @param {unknown} error Unknown failure.
 * @returns {string} Safe message.
 */
function getErrorMessage(error) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Unknown worker error.';
}

/**
 * Creates the DispatchIQ worker process coordinator.
 *
 * The job processor requires the persistent worker ID created during runtime
 * startup. A deferred processor function bridges that lifecycle dependency:
 * polling is configured before startup, while the concrete processor is
 * created immediately after worker registration succeeds.
 *
 * @param {{
 *   config?: ReturnType<typeof readWorkerConfig>,
 *   handlers?: Record<string, (job: object) => Promise<unknown>>,
 *   runtimeFactory?: typeof createWorkerRuntime,
 *   processorFactory?: typeof createJobProcessor,
 *   databaseClient?: { $disconnect: () => Promise<void> },
 *   processRef?: Pick<NodeJS.Process, 'once' | 'removeListener'>,
 *   logger?: {
 *     info: (message: string) => void,
 *     error: (message: string) => void
 *   }
 * }} [options] Worker process dependencies.
 * @returns {{
 *   start: () => Promise<object>,
 *   shutdown: (signal?: string) => Promise<void>,
 *   getRuntime: () => ReturnType<typeof createWorkerRuntime> | null,
 *   isStarted: () => boolean,
 *   isShuttingDown: () => boolean
 * }} Worker process controller.
 */
export function createWorkerProcess({
  config = readWorkerConfig(),
  handlers = jobHandlers,
  runtimeFactory = createWorkerRuntime,
  processorFactory = createJobProcessor,
  databaseClient = prisma,
  processRef = process,
  logger = defaultLogger,
} = {}) {
  let runtime = null;
  let processClaim = null;
  let worker = null;

  let started = false;
  let shuttingDown = false;
  let shutdownPromise = null;
  let signalHandlersRegistered = false;

  /**
   * Reports a runtime error without throwing from the polling loop.
   *
   * @param {unknown} error Runtime error.
   * @returns {void}
   */
  function reportRuntimeError(error) {
    logger.error(`[DispatchIQ Worker] ${getErrorMessage(error)}`);
  }

  /**
   * Handles a termination signal through graceful shutdown.
   *
   * @param {string} signal Signal name.
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
   * Removes process signal handlers after shutdown.
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
   * Starts the worker runtime.
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

      registerSignalHandlers();
      started = true;

      logger.info(`[DispatchIQ Worker] Online as ${worker.id} on ${config.hostname}.`);

      return worker;
    } catch (error) {
      runtime = null;
      worker = null;
      processClaim = null;

      throw error;
    }
  }

  /**
   * Gracefully stops runtime activity and disconnects Prisma.
   *
   * Multiple shutdown requests share the same promise so concurrent signals
   * cannot execute duplicate lifecycle transitions or database disconnections.
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

      try {
        if (runtime && started) {
          await runtime.stop();
        }
      } catch (error) {
        shutdownError = error;
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
    isStarted: () => started,
    isShuttingDown: () => shuttingDown,
  };
}

/**
 * Starts the process-level worker and reports fatal startup failures.
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
      // The original startup error remains the primary failure.
    }

    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  await main();
}
