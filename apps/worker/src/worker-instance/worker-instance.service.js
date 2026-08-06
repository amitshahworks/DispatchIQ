/**
 * @file worker-instance.service.js
 * @description Business logic for DispatchIQ worker-instance lifecycle
 * management.
 *
 * This service coordinates worker registration, runtime state transitions,
 * heartbeat updates, and graceful shutdown. Database access remains isolated
 * in the worker-instance repository.
 */

import {
  markWorkerAvailable,
  markWorkerBusy,
  markWorkerOffline,
  markWorkerOnline,
  markWorkerStopping,
  registerWorker,
  updateWorkerHeartbeat,
} from './worker-instance.repository.js';

/**
 * Creates a lifecycle error for a failed conditional worker transition.
 *
 * Repository transition methods return `{ count: 0 }` when the worker does
 * not exist or is no longer in the expected source state. The service converts
 * that database-level result into a clear runtime failure.
 *
 * @param {string} message Human-readable transition failure.
 * @returns {Error} Worker lifecycle error.
 */
function createWorkerLifecycleError(message) {
  const error = new Error(message);

  error.name = 'WorkerLifecycleError';

  return error;
}

/**
 * Ensures that exactly one worker row was updated.
 *
 * @param {{ count: number }} result Repository transition result.
 * @param {string} errorMessage Failure message.
 * @returns {void}
 * @throws {Error} When the transition did not update exactly one worker.
 */
function assertWorkerTransition(result, errorMessage) {
  if (result.count !== 1) {
    throw createWorkerLifecycleError(errorMessage);
  }
}

/**
 * Registers a worker process and transitions it from STARTING to ONLINE.
 *
 * If the ONLINE transition fails after registration, startup is treated as
 * unsuccessful because the runtime must never begin polling with an invalid
 * worker lifecycle state.
 *
 * @param {{
 *   hostname: string,
 *   startedAt?: Date,
 *   onlineAt?: Date
 * }} input Worker startup data.
 * @returns {Promise<{
 *   id: string,
 *   hostname: string,
 *   status: string,
 *   lastHeartbeatAt: Date,
 *   startedAt: Date,
 *   stoppedAt: Date | null
 * }>} Registered worker record.
 * @throws {Error} When the worker cannot transition to ONLINE.
 */
export async function startWorkerInstance({
  hostname,
  startedAt = new Date(),
  onlineAt = startedAt,
}) {
  const worker = await registerWorker({
    hostname,
    startedAt,
  });

  const transition = await markWorkerOnline({
    workerId: worker.id,
    onlineAt,
  });

  assertWorkerTransition(
    transition,
    'Worker startup failed because the instance could not transition to ONLINE.',
  );

  return {
    ...worker,
    status: 'ONLINE',
    lastHeartbeatAt: onlineAt,
  };
}

/**
 * Marks an ONLINE worker as BUSY before processing a claimed job.
 *
 * @param {{
 *   workerId: string,
 *   busyAt?: Date
 * }} input Busy transition data.
 * @returns {Promise<void>}
 * @throws {Error} When the worker cannot transition from ONLINE to BUSY.
 */
export async function setWorkerBusy({ workerId, busyAt = new Date() }) {
  const transition = await markWorkerBusy({
    workerId,
    busyAt,
  });

  assertWorkerTransition(transition, 'Worker could not transition from ONLINE to BUSY.');
}

/**
 * Marks a BUSY worker as ONLINE after job processing completes.
 *
 * @param {{
 *   workerId: string,
 *   onlineAt?: Date
 * }} input Availability transition data.
 * @returns {Promise<void>}
 * @throws {Error} When the worker cannot transition from BUSY to ONLINE.
 */
export async function setWorkerAvailable({ workerId, onlineAt = new Date() }) {
  const transition = await markWorkerAvailable({
    workerId,
    onlineAt,
  });

  assertWorkerTransition(transition, 'Worker could not transition from BUSY to ONLINE.');
}

/**
 * Persists a heartbeat for an active worker.
 *
 * A failed heartbeat indicates that the worker no longer exists or has moved
 * to a state that should not accept liveness updates. The runtime should treat
 * this as a serious lifecycle failure rather than silently continuing.
 *
 * @param {{
 *   workerId: string,
 *   heartbeatAt?: Date
 * }} input Heartbeat data.
 * @returns {Promise<void>}
 * @throws {Error} When no active worker row accepts the heartbeat.
 */
export async function heartbeatWorker({ workerId, heartbeatAt = new Date() }) {
  const result = await updateWorkerHeartbeat({
    workerId,
    heartbeatAt,
  });

  assertWorkerTransition(result, 'Worker heartbeat failed because the instance is not active.');
}

/**
 * Gracefully stops a worker through STOPPING and OFFLINE states.
 *
 * The service performs both transitions sequentially. If either operation
 * fails, shutdown reports the lifecycle error so the runtime can log it and
 * avoid falsely claiming a clean shutdown.
 *
 * @param {{
 *   workerId: string,
 *   stoppingAt?: Date,
 *   stoppedAt?: Date
 * }} input Shutdown transition data.
 * @returns {Promise<void>}
 * @throws {Error} When STOPPING or OFFLINE transition fails.
 */
export async function stopWorkerInstance({
  workerId,
  stoppingAt = new Date(),
  stoppedAt = stoppingAt,
}) {
  const stoppingTransition = await markWorkerStopping({
    workerId,
    stoppingAt,
  });

  assertWorkerTransition(
    stoppingTransition,
    'Worker shutdown failed because the instance could not transition to STOPPING.',
  );

  const offlineTransition = await markWorkerOffline({
    workerId,
    stoppedAt,
  });

  assertWorkerTransition(
    offlineTransition,
    'Worker shutdown failed because the instance could not transition to OFFLINE.',
  );
}
