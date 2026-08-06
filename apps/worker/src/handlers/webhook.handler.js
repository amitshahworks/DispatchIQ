/**
 * @file webhook.handler.js
 * @description Simulated WEBHOOK job handler for the DispatchIQ worker.
 *
 * The MVP validates webhook configuration and simulates an outbound HTTP
 * request. Real network requests are intentionally deferred until timeout,
 * retryability, authentication-header, and SSRF protections are implemented.
 */

const DEFAULT_SIMULATED_DELAY_MS = 25;

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

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
 * Determines whether a value is a non-array object.
 *
 * @param {unknown} value Value to inspect.
 * @returns {value is Record<string, unknown>} Whether the value is an object.
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a WEBHOOK job payload.
 *
 * Only HTTP and HTTPS destinations are accepted. This does not yet represent
 * complete SSRF protection; real network delivery will require a dedicated
 * outbound-request security policy.
 *
 * @param {unknown} payload Persisted job payload.
 * @returns {{
 *   url: string,
 *   method: string,
 *   body?: unknown
 * }} Normalized webhook payload.
 * @throws {Error} When webhook configuration is invalid.
 */
export function validateWebhookPayload(payload) {
  if (!isObject(payload)) {
    throw new Error('WEBHOOK job payload must be an object.');
  }

  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';

  if (!rawUrl) {
    throw new Error('WEBHOOK job payload requires a non-empty "url".');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('WEBHOOK job payload requires a valid URL.');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('WEBHOOK URL must use the HTTP or HTTPS protocol.');
  }

  const method = typeof payload.method === 'string' ? payload.method.trim().toUpperCase() : 'POST';

  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error(`WEBHOOK method "${method}" is not supported.`);
  }

  return {
    url: parsedUrl.toString(),
    method,
    ...(payload.body !== undefined
      ? {
          body: payload.body,
        }
      : {}),
  };
}

/**
 * Creates a simulated WEBHOOK handler.
 *
 * @param {{
 *   delayMs?: number,
 *   sleepFn?: (delayMs: number) => Promise<void>
 * }} [options] Handler configuration.
 * @returns {(job: object) => Promise<object>} WEBHOOK job handler.
 */
export function createWebhookHandler({
  delayMs = DEFAULT_SIMULATED_DELAY_MS,
  sleepFn = sleep,
} = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('WEBHOOK handler delayMs must be a non-negative integer.');
  }

  if (typeof sleepFn !== 'function') {
    throw new Error('WEBHOOK handler requires a sleep function.');
  }

  return async function handleWebhookJob(job) {
    if (!job || typeof job !== 'object') {
      throw new Error('WEBHOOK handler requires a job object.');
    }

    const payload = validateWebhookPayload(job.payload);

    await sleepFn(delayMs);

    return {
      jobId: job.id,
      type: 'WEBHOOK',
      transport: 'SIMULATED',
      url: payload.url,
      method: payload.method,
      statusCode: 200,
    };
  };
}

/**
 * Default WEBHOOK handler used by the worker runtime.
 */
export const webhookHandler = createWebhookHandler();
