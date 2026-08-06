/**
 * @file report-generation.handler.js
 * @description Simulated REPORT_GENERATION job handler for DispatchIQ.
 *
 * The MVP validates report-generation input and simulates producing an output
 * artifact. Real file generation and object-storage persistence will be added
 * later without changing the worker processor contract.
 */

const DEFAULT_SIMULATED_DELAY_MS = 50;

const SUPPORTED_FORMATS = new Set(['PDF', 'CSV', 'JSON']);

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
 * Validates a report-generation payload.
 *
 * The handler accepts either `report` or `reportType` during the MVP so older
 * seed data and current API examples remain compatible.
 *
 * @param {unknown} payload Persisted job payload.
 * @returns {{
 *   report: string,
 *   format: 'PDF' | 'CSV' | 'JSON',
 *   filters?: unknown
 * }} Normalized report configuration.
 * @throws {Error} When report configuration is invalid.
 */
export function validateReportGenerationPayload(payload) {
  if (!isObject(payload)) {
    throw new Error('REPORT_GENERATION job payload must be an object.');
  }

  const reportValue = typeof payload.report === 'string' ? payload.report : payload.reportType;

  const report = typeof reportValue === 'string' ? reportValue.trim() : '';

  if (!report) {
    throw new Error('REPORT_GENERATION payload requires a non-empty "report" or "reportType".');
  }

  const format = typeof payload.format === 'string' ? payload.format.trim().toUpperCase() : 'PDF';

  if (!SUPPORTED_FORMATS.has(format)) {
    throw new Error(`REPORT_GENERATION format "${format}" is not supported.`);
  }

  return {
    report,
    format,
    ...(payload.filters !== undefined
      ? {
          filters: payload.filters,
        }
      : {}),
  };
}

/**
 * Creates a simulated report-generation handler.
 *
 * @param {{
 *   delayMs?: number,
 *   sleepFn?: (delayMs: number) => Promise<void>
 * }} [options] Handler configuration.
 * @returns {(job: object) => Promise<object>} Report handler.
 */
export function createReportGenerationHandler({
  delayMs = DEFAULT_SIMULATED_DELAY_MS,
  sleepFn = sleep,
} = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error('REPORT_GENERATION handler delayMs must be a non-negative integer.');
  }

  if (typeof sleepFn !== 'function') {
    throw new Error('REPORT_GENERATION handler requires a sleep function.');
  }

  return async function handleReportGenerationJob(job) {
    if (!job || typeof job !== 'object') {
      throw new Error('REPORT_GENERATION handler requires a job object.');
    }

    const payload = validateReportGenerationPayload(job.payload);

    await sleepFn(delayMs);

    return {
      jobId: job.id,
      type: 'REPORT_GENERATION',
      generator: 'SIMULATED',
      report: payload.report,
      format: payload.format,
      artifactCreated: true,
    };
  };
}

/**
 * Default REPORT_GENERATION handler used by the worker runtime.
 */
export const reportGenerationHandler = createReportGenerationHandler();
