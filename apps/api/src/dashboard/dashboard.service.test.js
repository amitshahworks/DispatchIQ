/**
 * @file dashboard.service.test.js
 * @description Unit tests for DispatchIQ administrative dashboard business
 * logic.
 *
 * Metrics and worker services are mocked so these tests verify dashboard
 * composition, system-health classification, subsystem severity, shared
 * observation timestamps, and contract reuse independently of PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPlatformMetricsMock = vi.fn();
const getWorkerHealthMock = vi.fn();

vi.mock('../metrics/metrics.service.js', () => ({
  getPlatformMetrics: getPlatformMetricsMock,
}));

vi.mock('../workers/worker.service.js', () => ({
  getWorkerHealth: getWorkerHealthMock,
}));

const { getDashboardOverview, getSystemHealth } = await import('./dashboard.service.js');

/**
 * Creates a representative platform-metrics response.
 *
 * @param {object} [overrides] Top-level metric overrides.
 * @returns {object} Metrics fixture.
 */
function createMetrics(overrides = {}) {
  return {
    generatedAt: '2026-08-07T12:00:00.000Z',

    queue: {
      total: 100,
      scheduled: 5,
      queued: 0,
      processing: 2,
      retrying: 0,
      completed: 90,
      failed: 0,
      deadLetter: 0,
      cancelled: 3,
      pending: 5,
      claimable: 0,
      oldestClaimableJobAgeMs: null,
    },

    workers: {
      total: 3,
      starting: 0,
      online: 2,
      busy: 1,
      unhealthy: 0,
      offline: 0,
      stopping: 0,
      active: 3,
      available: 2,
      stale: 0,
    },

    execution: {
      totalAttempts: 95,
      processing: 0,
      completed: 95,
      failed: 0,
      timedOut: 0,
      successRate: 100,
      failureRate: 0,
      timeoutRate: 0,
      averageDurationMs: 120,
      averageAttemptsPerJob: 1,
    },

    throughput: {
      lastHour: {
        jobsCreated: 10,
        jobsCompleted: 12,
        attemptsCreated: 12,
      },

      last24Hours: {
        jobsCreated: 80,
        jobsCompleted: 75,
        attemptsCreated: 82,
      },
    },

    ...overrides,
  };
}

/**
 * Creates a representative worker-health response.
 *
 * @param {object} [overrides] Worker-health overrides.
 * @returns {object} Worker-health fixture.
 */
function createWorkerHealth(overrides = {}) {
  return {
    health: 'healthy',

    workers: {
      active: 3,
      stale: 0,

      byStatus: {
        STARTING: 0,
        ONLINE: 2,
        BUSY: 1,
        UNHEALTHY: 0,
        OFFLINE: 0,
        STOPPING: 0,
      },
    },

    oldestActiveHeartbeat: null,

    ...overrides,
  };
}

describe('dashboard service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDashboardOverview', () => {
    it('reuses the platform metrics service without duplicating metrics logic', async () => {
      const metrics = createMetrics();

      getPlatformMetricsMock.mockResolvedValue(metrics);

      const options = {
        now: new Date('2026-08-07T12:00:00.000Z'),
        staleAfterMs: 60_000,
      };

      const result = await getDashboardOverview(options);

      expect(getPlatformMetricsMock).toHaveBeenCalledOnce();

      expect(getPlatformMetricsMock).toHaveBeenCalledWith(options);

      expect(result).toEqual({
        generatedAt: metrics.generatedAt,
        queue: metrics.queue,
        workers: metrics.workers,
        execution: metrics.execution,
        throughput: metrics.throughput,
      });
    });

    it('does not query worker health separately for the overview endpoint', async () => {
      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      await getDashboardOverview();

      expect(getWorkerHealthMock).not.toHaveBeenCalled();
    });

    it('propagates metrics-service failures', async () => {
      const error = new Error('Metrics unavailable.');

      getPlatformMetricsMock.mockRejectedValue(error);

      await expect(getDashboardOverview()).rejects.toBe(error);
    });
  });

  describe('getSystemHealth', () => {
    it('returns healthy when all operational subsystems are healthy', async () => {
      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const now = new Date('2026-08-07T12:00:00.000Z');

      const result = await getSystemHealth({
        now,
        staleAfterMs: 60_000,
      });

      expect(result).toEqual({
        generatedAt: '2026-08-07T12:00:00.000Z',

        status: 'healthy',

        queue: {
          status: 'healthy',
          claimable: 0,
          pending: 5,
          failed: 0,
          deadLetter: 0,
        },

        workers: {
          status: 'healthy',
          active: 3,
          stale: 0,
        },

        execution: {
          status: 'healthy',
          successRate: 100,
          failureRate: 0,
          timeoutRate: 0,
        },
      });
    });

    it('uses the same observation time for platform and worker health', async () => {
      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const now = new Date('2026-08-07T12:00:00.000Z');

      await getSystemHealth({
        now,
        staleAfterMs: 45_000,
      });

      expect(getPlatformMetricsMock).toHaveBeenCalledWith({
        now,
        staleAfterMs: 45_000,
      });

      expect(getWorkerHealthMock).toHaveBeenCalledWith({
        asOf: now,
        staleAfterMs: 45_000,
      });
    });

    it('returns degraded when claimable jobs are waiting but worker capacity exists', async () => {
      const metrics = createMetrics();

      metrics.queue.claimable = 8;
      metrics.queue.pending = 8;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const result = await getSystemHealth();

      expect(result.status).toBe('degraded');

      expect(result.queue.status).toBe('degraded');
    });

    it('returns critical queue health when claimable work exists without active workers', async () => {
      const metrics = createMetrics();

      metrics.queue.claimable = 12;
      metrics.queue.pending = 12;
      metrics.workers.active = 0;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(
        createWorkerHealth({
          health: 'unavailable',

          workers: {
            active: 0,
            stale: 0,
            byStatus: {},
          },
        }),
      );

      const result = await getSystemHealth();

      expect(result.status).toBe('critical');

      expect(result.queue.status).toBe('critical');

      expect(result.workers.status).toBe('critical');
    });

    it('returns degraded when failed jobs are present', async () => {
      const metrics = createMetrics();

      metrics.queue.failed = 3;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const result = await getSystemHealth();

      expect(result.queue.status).toBe('degraded');

      expect(result.status).toBe('degraded');
    });

    it('returns degraded when dead-letter jobs are present', async () => {
      const metrics = createMetrics();

      metrics.queue.deadLetter = 2;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const result = await getSystemHealth();

      expect(result.queue.status).toBe('degraded');
    });

    it('returns degraded when worker health is degraded', async () => {
      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      getWorkerHealthMock.mockResolvedValue(
        createWorkerHealth({
          health: 'degraded',

          workers: {
            active: 2,
            stale: 1,
            byStatus: {},
          },
        }),
      );

      const result = await getSystemHealth();

      expect(result.workers).toEqual({
        status: 'degraded',
        active: 2,
        stale: 1,
      });

      expect(result.status).toBe('degraded');
    });

    it('returns critical when worker capacity is unavailable', async () => {
      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      getWorkerHealthMock.mockResolvedValue(
        createWorkerHealth({
          health: 'unavailable',

          workers: {
            active: 0,
            stale: 0,
            byStatus: {},
          },
        }),
      );

      const result = await getSystemHealth();

      expect(result.workers.status).toBe('critical');

      expect(result.status).toBe('critical');
    });

    it('returns degraded execution health when execution failures exist below the critical threshold', async () => {
      const metrics = createMetrics();

      metrics.execution.failed = 2;
      metrics.execution.failureRate = 10;
      metrics.execution.successRate = 90;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const result = await getSystemHealth();

      expect(result.execution.status).toBe('degraded');

      expect(result.status).toBe('degraded');
    });

    it('returns critical execution health when failure and timeout pressure reaches fifty percent', async () => {
      const metrics = createMetrics();

      metrics.execution.failed = 4;
      metrics.execution.timedOut = 1;
      metrics.execution.failureRate = 40;
      metrics.execution.timeoutRate = 10;
      metrics.execution.successRate = 50;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(createWorkerHealth());

      const result = await getSystemHealth();

      expect(result.execution.status).toBe('critical');

      expect(result.status).toBe('critical');
    });

    it('uses the most severe subsystem state as overall health', async () => {
      const metrics = createMetrics();

      metrics.queue.failed = 1;

      metrics.execution.failed = 5;
      metrics.execution.failureRate = 60;
      metrics.execution.successRate = 40;

      getPlatformMetricsMock.mockResolvedValue(metrics);

      getWorkerHealthMock.mockResolvedValue(
        createWorkerHealth({
          health: 'degraded',

          workers: {
            active: 2,
            stale: 1,
            byStatus: {},
          },
        }),
      );

      const result = await getSystemHealth();

      expect(result.queue.status).toBe('degraded');

      expect(result.workers.status).toBe('degraded');

      expect(result.execution.status).toBe('critical');

      expect(result.status).toBe('critical');
    });

    it('propagates dependency failures', async () => {
      const error = new Error('Worker health unavailable.');

      getPlatformMetricsMock.mockResolvedValue(createMetrics());

      getWorkerHealthMock.mockRejectedValue(error);

      await expect(getSystemHealth()).rejects.toBe(error);
    });
  });
});
