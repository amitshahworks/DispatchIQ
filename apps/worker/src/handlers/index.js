/**
 * @file index.js
 * @description Public registry of DispatchIQ worker job handlers.
 *
 * JobType enum values map directly to handler functions. The job processor
 * uses this registry to dispatch a claimed job without containing
 * type-specific execution logic.
 */

import { emailHandler } from './email.handler.js';
import { reportGenerationHandler } from './report-generation.handler.js';
import { webhookHandler } from './webhook.handler.js';

/**
 * Immutable default handler registry used by the worker runtime.
 */
export const jobHandlers = Object.freeze({
  EMAIL: emailHandler,
  WEBHOOK: webhookHandler,
  REPORT_GENERATION: reportGenerationHandler,
});

export { createEmailHandler, emailHandler, validateEmailPayload } from './email.handler.js';

export { createWebhookHandler, validateWebhookPayload, webhookHandler } from './webhook.handler.js';

export {
  createReportGenerationHandler,
  reportGenerationHandler,
  validateReportGenerationPayload,
} from './report-generation.handler.js';
