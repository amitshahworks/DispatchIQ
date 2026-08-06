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

const { createWorkerProcess, readWorkerConfig } = await import('./worker.js');

const workerConfig = Object.freeze({
  hostname: 'dispatchiq-worker-01',
  pollIntervalMs: 1_000,
  heartbeatIntervalMs: 10_000,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 60_000,
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
    let resolveRuntimeStop;

    runtimeStopMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRuntimeStop = resolve;
        }),
    );

    const workerProcess = createTestWorkerProcess();

    await workerProcess.start();

    const firstShutdown = workerProcess.shutdown('SIGINT');

    const secondShutdown = workerProcess.shutdown('SIGTERM');

    expect(firstShutdown).toBe(secondShutdown);
    expect(runtimeStopMock).toHaveBeenCalledOnce();

    resolveRuntimeStop();

    await firstShutdown;

    expect(disconnectMock).toHaveBeenCalledOnce();
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
});

describe('worker configuration', () => {
  it('applies safe defaults', () => {
    expect(readWorkerConfig({}, 'worker-host')).toEqual({
      hostname: 'worker-host',
      pollIntervalMs: 1_000,
      heartbeatIntervalMs: 10_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 300_000,
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
        },
        'fallback-host',
      ),
    ).toEqual({
      hostname: 'worker-02',
      pollIntervalMs: 2_000,
      heartbeatIntervalMs: 15_000,
      retryBaseDelayMs: 3_000,
      retryMaxDelayMs: 120_000,
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
});
