/**
 * @file dashboard.service.js
 * @description Business logic for the DispatchIQ administrative dashboard.
 *
 * The dashboard service composes existing operational services instead of
 * duplicating queue, worker, execution, or throughput calculations.
 *
 * Platform metrics remain owned by metrics.service.js, while worker-cluster
 * health remains owned by worker.service.js. This module is responsible only
 * for composing those established contracts into dashboard-oriented views and
 * deriving high-level system-health classifications.
 */

import { getPlatformMetrics } from '../metrics/metrics.service.js';
import { getWorkerHealth } from '../workers/worker.service.js';

/**
 * Determines the operational health of the queue.
 *
 * Queue health is derived from already-normalized platform metrics:
 *
 * - healthy: no failed/dead-letter pressure and claimable work is manageable;
 * - degraded: failed, dead-letter, or growing claimable work is present;
 * - critical: claimable work exists while no worker capacity is available.
 *
 * This classification intentionally remains lightweight. It provides a useful
 * dashboard signal without replacing detailed metrics or introducing hidden
 * persistence rules.
 *
 * @param {object} metrics Platform metrics snapshot.
 * @returns {'healthy' | 'degraded' | 'critical'} Queue-health state.
 */
function deriveQueueHealth(metrics) {
  const { queue, workers } = metrics;

  if (queue.claimable > 0 && workers.active === 0) {
    return 'critical';
  }

  if (queue.failed > 0 || queue.deadLetter > 0 || queue.claimable > 0) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Determines worker-subsystem health from worker-cluster health information.
 *
 * @param {object} workerHealth Worker-cluster health response.
 * @returns {'healthy' | 'degraded' | 'critical'} Worker-health state.
 */
function deriveWorkerHealth(workerHealth) {
  if (workerHealth.health === 'unavailable') {
    return 'critical';
  }

  if (workerHealth.health === 'degraded') {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Determines execution-subsystem health from aggregate reliability metrics.
 *
 * Failure and timeout rates are evaluated conservatively:
 *
 * - critical: combined failure/timeout rate is 50% or greater;
 * - degraded: any failed or timed-out attempts are present;
 * - healthy: no terminal execution failures are currently represented.
 *
 * @param {object} execution Execution metrics.
 * @returns {'healthy' | 'degraded' | 'critical'} Execution-health state.
 */
function deriveExecutionHealth(execution) {
  const failurePressure = execution.failureRate + execution.timeoutRate;

  if (failurePressure >= 50) {
    return 'critical';
  }

  if (execution.failed > 0 || execution.timedOut > 0) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Returns the most severe health state from a collection of subsystem states.
 *
 * @param {Array<'healthy' | 'degraded' | 'critical'>} states Health states.
 * @returns {'healthy' | 'degraded' | 'critical'} Overall health state.
 */
function resolveOverallHealth(states) {
  if (states.includes('critical')) {
    return 'critical';
  }

  if (states.includes('degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * Returns the administrative dashboard overview.
 *
 * The dashboard intentionally reuses the existing platform metrics contract
 * rather than issuing duplicate Prisma queries. The result therefore remains
 * consistent with `/api/v1/metrics`.
 *
 * @param {{
 *   now?: Date,
 *   staleAfterMs?: number
 * }} [options] Metrics observation options.
 * @returns {Promise<{
 *   generatedAt: string,
 *   queue: object,
 *   workers: object,
 *   execution: object,
 *   throughput: object
 * }>} Dashboard overview.
 */
export async function getDashboardOverview(options = {}) {
  const metrics = await getPlatformMetrics(options);

  return {
    generatedAt: metrics.generatedAt,
    queue: metrics.queue,
    workers: metrics.workers,
    execution: metrics.execution,
    throughput: metrics.throughput,
  };
}

/**
 * Returns a high-level system-health summary for administrative monitoring.
 *
 * Platform metrics and worker-cluster health are fetched in parallel because
 * both operations are independent read-only observations.
 *
 * @param {{
 *   now?: Date,
 *   staleAfterMs?: number
 * }} [options] Health observation configuration.
 * @returns {Promise<{
 *   generatedAt: string,
 *   status: 'healthy' | 'degraded' | 'critical',
 *   queue: {
 *     status: string,
 *     claimable: number,
 *     pending: number,
 *     failed: number,
 *     deadLetter: number
 *   },
 *   workers: {
 *     status: string,
 *     active: number,
 *     stale: number
 *   },
 *   execution: {
 *     status: string,
 *     successRate: number,
 *     failureRate: number,
 *     timeoutRate: number
 *   }
 * }>} System-health summary.
 */
export async function getSystemHealth(options = {}) {
  const now = options.now ?? new Date();

  const metricsOptions = {
    ...options,
    now,
  };

  const workerOptions = {
    asOf: now,

    ...(options.staleAfterMs !== undefined
      ? {
          staleAfterMs: options.staleAfterMs,
        }
      : {}),
  };

  const [metrics, workerHealth] = await Promise.all([
    getPlatformMetrics(metricsOptions),
    getWorkerHealth(workerOptions),
  ]);

  const queueStatus = deriveQueueHealth(metrics);

  const workerStatus = deriveWorkerHealth(workerHealth);

  const executionStatus = deriveExecutionHealth(metrics.execution);

  const status = resolveOverallHealth([queueStatus, workerStatus, executionStatus]);

  return {
    generatedAt: metrics.generatedAt,

    status,

    queue: {
      status: queueStatus,
      claimable: metrics.queue.claimable,
      pending: metrics.queue.pending,
      failed: metrics.queue.failed,
      deadLetter: metrics.queue.deadLetter,
    },

    workers: {
      status: workerStatus,
      active: workerHealth.workers.active,
      stale: workerHealth.workers.stale,
    },

    execution: {
      status: executionStatus,
      successRate: metrics.execution.successRate,
      failureRate: metrics.execution.failureRate,
      timeoutRate: metrics.execution.timeoutRate,
    },
  };
}
