/**
 * @file worker-instance.repository.js
 * @description Prisma data-access operations for DispatchIQ worker-instance
 * lifecycle management.
 *
 * Each running worker process registers a WorkerInstance row and periodically
 * updates its heartbeat. Conditional status transitions prevent stale or
 * duplicated worker processes from overwriting newer lifecycle state.
 */

import { prisma } from '@dispatchiq/database';

/**
 * Registers a newly started worker process.
 *
 * Worker instances begin in STARTING state. The runtime marks the instance
 * ONLINE only after initialization has completed successfully.
 *
 * @param {{
 *   hostname: string,
 *   startedAt?: Date
 * }} input Worker registration data.
 * @returns {Promise<{
 *   id: string,
 *   hostname: string,
 *   status: string,
 *   lastHeartbeatAt: Date,
 *   startedAt: Date,
 *   stoppedAt: Date | null
 * }>} Created worker-instance record.
 */
export function registerWorker({ hostname, startedAt = new Date() }) {
  return prisma.workerInstance.create({
    data: {
      hostname,
      status: 'STARTING',
      startedAt,
      lastHeartbeatAt: startedAt,
    },
  });
}

/**
 * Marks an initialized worker as online.
 *
 * The conditional transition prevents an instance already marked STOPPING or
 * OFFLINE from being accidentally returned to service.
 *
 * @param {{
 *   workerId: string,
 *   onlineAt?: Date
 * }} input Online transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned workers.
 */
export function markWorkerOnline({ workerId, onlineAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: 'STARTING',
    },
    data: {
      status: 'ONLINE',
      lastHeartbeatAt: onlineAt,
    },
  });
}

/**
 * Marks an online worker as busy while it owns an active job.
 *
 * @param {{
 *   workerId: string,
 *   busyAt?: Date
 * }} input Busy transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned workers.
 */
export function markWorkerBusy({ workerId, busyAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: 'ONLINE',
    },
    data: {
      status: 'BUSY',
      lastHeartbeatAt: busyAt,
    },
  });
}

/**
 * Returns a busy worker to online status after job processing finishes.
 *
 * @param {{
 *   workerId: string,
 *   onlineAt?: Date
 * }} input Availability transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned workers.
 */
export function markWorkerAvailable({ workerId, onlineAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: 'BUSY',
    },
    data: {
      status: 'ONLINE',
      lastHeartbeatAt: onlineAt,
    },
  });
}

/**
 * Updates the liveness timestamp for an active worker.
 *
 * Heartbeats are accepted only for states representing a running process.
 * OFFLINE workers therefore cannot be revived merely by a late heartbeat.
 *
 * @param {{
 *   workerId: string,
 *   heartbeatAt?: Date
 * }} input Heartbeat update data.
 * @returns {Promise<{ count: number }>} Number of workers updated.
 */
export function updateWorkerHeartbeat({ workerId, heartbeatAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: {
        in: ['STARTING', 'ONLINE', 'BUSY', 'STOPPING'],
      },
    },
    data: {
      lastHeartbeatAt: heartbeatAt,
    },
  });
}

/**
 * Marks a running worker as stopping during graceful shutdown.
 *
 * STARTING is included because shutdown may begin before initialization
 * finishes. ONLINE and BUSY represent the normal runtime states.
 *
 * @param {{
 *   workerId: string,
 *   stoppingAt?: Date
 * }} input Shutdown transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned workers.
 */
export function markWorkerStopping({ workerId, stoppingAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: {
        in: ['STARTING', 'ONLINE', 'BUSY', 'UNHEALTHY'],
      },
    },
    data: {
      status: 'STOPPING',
      lastHeartbeatAt: stoppingAt,
    },
  });
}

/**
 * Marks a stopping worker as offline and records when its process ended.
 *
 * This transition is intentionally limited to STOPPING so normal graceful
 * shutdown follows a deterministic lifecycle. Crash recovery may later use a
 * separate operation to mark stale workers OFFLINE.
 *
 * @param {{
 *   workerId: string,
 *   stoppedAt?: Date
 * }} input Offline transition data.
 * @returns {Promise<{ count: number }>} Number of transitioned workers.
 */
export function markWorkerOffline({ workerId, stoppedAt = new Date() }) {
  return prisma.workerInstance.updateMany({
    where: {
      id: workerId,
      status: 'STOPPING',
    },
    data: {
      status: 'OFFLINE',
      lastHeartbeatAt: stoppedAt,
      stoppedAt,
    },
  });
}

/**
 * Finds one worker instance by ID.
 *
 * @param {string} workerId Worker-instance identifier.
 * @returns {Promise<object | null>} Worker record or null.
 */
export function findWorkerById(workerId) {
  return prisma.workerInstance.findUnique({
    where: {
      id: workerId,
    },
  });
}
