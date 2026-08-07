/**
 * @file worker.test.js
 * @description Unit tests for the DispatchIQ worker process entrypoint.
 *
 * These tests verify configuration parsing, runtime composition, processor
 * initialization, signal registration, graceful shutdown, and failure
 * handling without creating real timers or database connections.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStartMock = vi.fn();
const runtimeStopMock = vi.fn();
const runtimeFactoryMock = vi.fn();

const processClaimMock = vi.fn();
const processorFactoryMock = vi.fn();

const disconnectMock = vi.fn();

const processOnceMock = vi.fn();
const processRemoveListenerMock = vi.fn();

const loggerInfoMock = vi.fn();
const loggerErrorMock = vi.fn();

const recoveryServiceFactoryMock = vi.fn();
const recoverAllWorkersMock = vi.fn();

const recoverySchedulerFactoryMock = vi.fn();
const recoverySchedulerStopMock = vi.fn();

const { createWorkerProcess, readWorkerConfig } = await import('./worker.js');

const workerConfig = Object.freeze({
  hostname: 'dispatchiq-worker-01',
  pollIntervalMs: 1_000,
  heartbeatIntervalMs: 10_000,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 60_000,
  recoveryIntervalMs: 15_000,
  staleAfterMs: 30_000,
  recoveryBatchLimit: 100,
});

/**
 * Creates a worker process with mocked dependencies.
 *
 * @param {object} [overrides] Dependency overrides.
 * @returns {ReturnType<typeof createWorkerProcess>} Worker controller.
 */
function createTestWorkerProcess(overrides = {}) {
  return createWorkerProcess({
    config: workerConfig,
    handlers: {
      EMAIL: vi.fn(),
    },
    runtimeFactory: runtimeFactoryMock,
    processorFactory: processorFactoryMock,
    recoveryServiceFactory: recoveryServiceFactoryMock,
    recoverySchedulerFactory: recoverySchedulerFactoryMock,
    databaseClient: {
      $disconnect: disconnectMock,
    },
    processRef: {
      once: processOnceMock,
      removeListener: processRemoveListenerMock,
    },
    logger: {
      info: loggerInfoMock,
      error: loggerErrorMock,
    },
    ...overrides,
  });
}

describe('worker process entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    runtimeStartMock.mockResolvedValue({
      id: 'worker-123',
      hostname: workerConfig.hostname,
      status: 'ONLINE',
    });

    runtimeStopMock.mockResolvedValue(undefined);

    runtimeFactoryMock.mockReturnValue({
      start: runtimeStartMock,
      stop: runtimeStopMock,
      pollNow: vi.fn(),
      isRunning: vi.fn(() => true),
      isStopping: vi.fn(() => false),
      getWorkerId: vi.fn(() => 'worker-123'),
    });

    processorFactoryMock.mockReturnValue(processClaimMock);
    processClaimMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);

    recoverAllWorkersMock.mockResolvedValue({
      workersRecovered: 0,
      jobsRecovered: 0,
      jobsRetried: 0,
      jobsDeadLettered: 0,
      failures: [],
    });

    recoveryServiceFactoryMock.mockReturnValue({
      findStaleWorkers: vi.fn(),
      recoverWorker: vi.fn(),
      recoverAllWorkers: recoverAllWorkersMock,
    });

    recoverySchedulerStopMock.mockResolvedValue(undefined);

    recoverySchedulerFactoryMock.mockReturnValue({
      runNow: vi.fn(),
      stop: recoverySchedulerStopMock,
      isRunning: vi.fn(() => true),
      isRecovering: vi.fn(() => false),
    });
  });

  it('builds and starts the runtime before creating the job processor', async () => {
    const workerProcess = createTestWorkerProcess();

    const worker = await workerProcess.start();

    expect(runtimeFactoryMock).toHaveBeenCalledOnce();

    expect(runtimeFactoryMock).toHaveBeenCalledWith({
      hostname: workerConfig.hostname,
      pollIntervalMs: workerConfig.pollIntervalMs,
      heartbeatIntervalMs: workerConfig.heartbeatIntervalMs,
      processClaim: expect.any(Function),
      onError: expect.any(Function),
    });

    expect(runtimeStartMock).toHaveBeenCalledOnce();

    expect(processorFactoryMock).toHaveBeenCalledWith({
      workerId: 'worker-123',
      handlers: {
        EMAIL: expect.any(Function),
      },
      retryBaseDelayMs: workerConfig.retryBaseDelayMs,
      retryMaxDelayMs: workerConfig.retryMaxDelayMs,
    });

    expect(worker).toMatchObject({
      id: 'worker-123',
      status: 'ONLINE',
    });

    expect(workerProcess.isStarted()).toBe(true);
  });

  it('delegates runtime claims to the initialized processor', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    const runtimeOptions = runtimeFactoryMock.mock.calls[0][0];

    const claim = {
      job: {
        id: 'job-123',
      },
      attempt: {
        id: 'attempt-123',
      },
    };

    await runtimeOptions.processClaim(claim);

    expect(processClaimMock).toHaveBeenCalledWith(claim);
  });

  it('registers SIGINT and SIGTERM handlers after startup', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    expect(processOnceMock).toHaveBeenCalledTimes(2);
    expect(processOnceMock).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnceMock).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('does not start the same worker process twice', async () => {
    const workerProcess = createTestWorkerProcess();

    const firstWorker = await workerProcess.start();
    const secondWorker = await workerProcess.start();

    expect(runtimeFactoryMock).toHaveBeenCalledOnce();
    expect(runtimeStartMock).toHaveBeenCalledOnce();
    expect(processorFactoryMock).toHaveBeenCalledOnce();
    expect(secondWorker).toBe(firstWorker);
  });

  it('reports runtime errors through the configured logger', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    const runtimeOptions = runtimeFactoryMock.mock.calls[0][0];

    runtimeOptions.onError(new Error('Database temporarily unavailable.'));

    expect(loggerErrorMock).toHaveBeenCalledWith(
      '[DispatchIQ Worker] Database temporarily unavailable.',
    );
  });

  it('stops the runtime and disconnects the database', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();
    await workerProcess.shutdown('SIGTERM');

    expect(runtimeStopMock).toHaveBeenCalledOnce();
    expect(disconnectMock).toHaveBeenCalledOnce();

    expect(processRemoveListenerMock).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    expect(processRemoveListenerMock).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    expect(workerProcess.isStarted()).toBe(false);
    expect(workerProcess.isShuttingDown()).toBe(true);

    expect(loggerInfoMock).toHaveBeenCalledWith('[DispatchIQ Worker] Shutdown complete.');
  });

  it('shares one shutdown operation across repeated calls', async () => {
    let resolveRecovery;
    let resolveRuntime;

    recoverySchedulerStopMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    runtimeStopMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve;
        }),
    );

    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    const firstShutdown = workerProcess.shutdown('SIGINT');
    const secondShutdown = workerProcess.shutdown('SIGTERM');

    expect(firstShutdown).toBe(secondShutdown);

    expect(recoverySchedulerStopMock).toHaveBeenCalledTimes(1);

    resolveRecovery();

    await Promise.resolve();

    expect(runtimeStopMock).toHaveBeenCalledTimes(1);

    resolveRuntime();

    await firstShutdown;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects the database even when runtime shutdown fails', async () => {
    const error = new Error('Worker lifecycle shutdown failed.');

    runtimeStopMock.mockRejectedValue(error);

    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    await expect(workerProcess.shutdown('SIGTERM')).rejects.toThrow(
      'Worker lifecycle shutdown failed.',
    );

    expect(disconnectMock).toHaveBeenCalledOnce();
  });

  it('can disconnect safely before the worker starts', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.shutdown();

    expect(runtimeStopMock).not.toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalledOnce();
  });

  it('clears partial state when runtime startup fails', async () => {
    runtimeStartMock.mockRejectedValue(new Error('PostgreSQL unavailable.'));

    const workerProcess = createTestWorkerProcess();

    await expect(workerProcess.start()).rejects.toThrow('PostgreSQL unavailable.');

    expect(processorFactoryMock).not.toHaveBeenCalled();
    expect(processOnceMock).not.toHaveBeenCalled();
    expect(workerProcess.getRuntime()).toBeNull();
    expect(workerProcess.isStarted()).toBe(false);
  });

  it('configures and starts stale-worker recovery after worker registration', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    expect(recoveryServiceFactoryMock).toHaveBeenCalledOnce();

    expect(recoveryServiceFactoryMock).toHaveBeenCalledWith({
      staleAfterMs: 30_000,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 60_000,
      staleWorkerLimit: 100,
    });

    expect(recoverySchedulerFactoryMock).toHaveBeenCalledOnce();

    expect(recoverySchedulerFactoryMock).toHaveBeenCalledWith({
      intervalMs: 15_000,
      recoverAllWorkers: recoverAllWorkersMock,
      onError: expect.any(Function),
      onRecovery: expect.any(Function),
    });

    expect(workerProcess.getRecoveryScheduler()).not.toBeNull();
  });

  it('stops recovery before stopping the worker runtime', async () => {
    const shutdownOrder = [];

    recoverySchedulerStopMock.mockImplementation(async () => {
      shutdownOrder.push('recovery');
    });

    runtimeStopMock.mockImplementation(async () => {
      shutdownOrder.push('runtime');
    });

    disconnectMock.mockImplementation(async () => {
      shutdownOrder.push('database');
    });

    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();
    await workerProcess.shutdown('SIGTERM');

    expect(shutdownOrder).toEqual(['recovery', 'runtime', 'database']);
  });

  it('reports meaningful recovery summaries', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    const schedulerOptions = recoverySchedulerFactoryMock.mock.calls[0][0];

    schedulerOptions.onRecovery({
      workersRecovered: 2,
      jobsRecovered: 3,
      jobsRetried: 2,
      jobsDeadLettered: 1,
      failures: [],
    });

    expect(loggerInfoMock).toHaveBeenCalledWith(
      '[DispatchIQ Worker] Recovery cycle completed: 2 worker(s), 3 job(s), 0 failure(s).',
    );
  });

  it('keeps empty recovery cycles silent', async () => {
    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    loggerInfoMock.mockClear();

    const schedulerOptions = recoverySchedulerFactoryMock.mock.calls[0][0];

    schedulerOptions.onRecovery({
      workersRecovered: 0,
      jobsRecovered: 0,
      jobsRetried: 0,
      jobsDeadLettered: 0,
      failures: [],
    });

    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it('rolls back the runtime when recovery scheduler startup fails', async () => {
    recoverySchedulerFactoryMock.mockImplementation(() => {
      throw new Error('Recovery scheduler initialization failed.');
    });

    const workerProcess = createTestWorkerProcess();

    await expect(workerProcess.start()).rejects.toThrow(
      'Recovery scheduler initialization failed.',
    );

    expect(runtimeStopMock).toHaveBeenCalledOnce();

    expect(workerProcess.isStarted()).toBe(false);

    expect(workerProcess.getRuntime()).toBeNull();

    expect(workerProcess.getRecoveryScheduler()).toBeNull();
  });
});

describe('worker configuration', () => {
  it('applies safe defaults', () => {
    expect(readWorkerConfig({}, 'worker-host')).toEqual({
      hostname: 'worker-host',
      pollIntervalMs: 1_000,
      heartbeatIntervalMs: 10_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 300_000,
      recoveryIntervalMs: 15_000,
      staleAfterMs: 30_000,
      recoveryBatchLimit: 100,
    });
  });

  it('normalizes supplied environment values', () => {
    expect(
      readWorkerConfig(
        {
          WORKER_HOSTNAME: '  worker-02  ',
          WORKER_POLL_INTERVAL_MS: '2000',
          WORKER_HEARTBEAT_INTERVAL_MS: '15000',
          WORKER_RETRY_BASE_DELAY_MS: '3000',
          WORKER_RETRY_MAX_DELAY_MS: '120000',
          WORKER_RECOVERY_INTERVAL_MS: '15000',
          WORKER_STALE_AFTER_MS: '30000',
          WORKER_RECOVERY_BATCH_LIMIT: '100',
        },
        'fallback-host',
      ),
    ).toEqual({
      hostname: 'worker-02',
      pollIntervalMs: 2_000,
      heartbeatIntervalMs: 15_000,
      retryBaseDelayMs: 3_000,
      retryMaxDelayMs: 120_000,
      recoveryIntervalMs: 15_000,
      staleAfterMs: 30_000,
      recoveryBatchLimit: 100,
    });
  });

  it.each([
    ['WORKER_POLL_INTERVAL_MS', '0'],
    ['WORKER_HEARTBEAT_INTERVAL_MS', '-1'],
    ['WORKER_RETRY_BASE_DELAY_MS', '1.5'],
    ['WORKER_RETRY_MAX_DELAY_MS', 'invalid'],
  ])('rejects invalid %s configuration', (variableName, value) => {
    expect(() =>
      readWorkerConfig(
        {
          [variableName]: value,
        },
        'worker-host',
      ),
    ).toThrow(`${variableName} must be a positive integer.`);
  });

  it('rejects a retry maximum below the base delay', () => {
    expect(() =>
      readWorkerConfig(
        {
          WORKER_RETRY_BASE_DELAY_MS: '10000',
          WORKER_RETRY_MAX_DELAY_MS: '5000',
        },
        'worker-host',
      ),
    ).toThrow('WORKER_RETRY_MAX_DELAY_MS cannot be lower than WORKER_RETRY_BASE_DELAY_MS.');
  });

  it('rejects an empty resolved hostname', () => {
    expect(() => readWorkerConfig({}, '   ')).toThrow('Worker hostname cannot be empty.');
  });

  it('rejects a stale threshold that does not exceed the heartbeat interval', () => {
    expect(() =>
      readWorkerConfig(
        {
          WORKER_HEARTBEAT_INTERVAL_MS: '10000',
          WORKER_STALE_AFTER_MS: '10000',
        },
        'worker-host',
      ),
    ).toThrow('WORKER_STALE_AFTER_MS must be greater than WORKER_HEARTBEAT_INTERVAL_MS.');
  });
});
