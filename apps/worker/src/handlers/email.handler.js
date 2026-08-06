/**
 * @file email.handler.js
 * @description Simulated EMAIL job handler for the DispatchIQ worker.
 *
 * The MVP does not connect to a real email provider. This handler validates
 * the persisted job payload and simulates asynchronous delivery. A future
 * provider integration can replace the simulated operation without changing
 * the job processor or worker runtime.
 */

const DEFAULT_SIMULATED_DELAY_MS = 25;

/**
 * Resolves after the supplied delay.
 *
 * @param {number} delayMs Delay duration in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * Determines whether a value is a plain object suitable for payload access.
 *
 * @param {unknown} value Value to inspect.
 * @returns {value is Record<string, unknown>} Whether the value is an object.
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an EMAIL job payload.
 *
 * @param {unknown} payload Persisted job payload.
 * @returns {{
 *   to: string,
 *   subject: string,
 *   body?: string
 * }} Normalized email payload.
 * @throws {Error} When required email fields are missing or invalid.
 */
export function validateEmailPayload(payload) {
  if (!isObject(payload)) {
    throw new Error('EMAIL job payload must be an object.');
  }

  const to = typeof payload.to === 'string' ? payload.to.trim() : '';

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';

  if (!to || !to.includes('@')) {
    throw new Error('EMAIL job payload requires a valid "to" address.');
  }

  if (!subject) {
    throw new Error('EMAIL job payload requires a non-empty "subject".');
  }

  if (payload.body !== undefined && typeof payload.body !== 'string') {
    throw new Error('EMAIL job payload "body" must be a string when provided.');
  }

  return {
    to,
    subject,
    ...(payload.body !== undefined
      ? {
          body: payload.body,
        }
      : {}),
  };
}

/**
 * Creates an EMAIL handler with injectable timing dependencies.
 *
 * Dependency injection keeps tests deterministic and allows the production
 * implementation to simulate asynchronous provider communication.
 *
 * @param {{
 *   delayMs?: number,
 *   sleepFn?: (delayMs: number) => Promise<void>
 * }} [options] Handler configuration.
 * @returns {(job: object) => Promise<object>} EMAIL job handler.
 */
export function createEmailHandler({ delayMs = DEFAULT_SIMULATED_DELAY_MS, sleepFn = sleep } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('EMAIL handler delayMs must be a non-negative integer.');
  }

  if (typeof sleepFn !== 'function') {
    throw new Error('EMAIL handler requires a sleep function.');
  }

  return async function handleEmailJob(job) {
    if (!job || typeof job !== 'object') {
      throw new Error('EMAIL handler requires a job object.');
    }

    const payload = validateEmailPayload(job.payload);

    await sleepFn(delayMs);

    return {
      jobId: job.id,
      type: 'EMAIL',
      provider: 'SIMULATED',
      recipient: payload.to,
      delivered: true,
    };
  };
}

/**
 * Default EMAIL handler used by the worker runtime.
 */
export const emailHandler = createEmailHandler();
