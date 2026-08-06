/**
 * @file job.validation.js
 * @description Zod schemas for validating DispatchIQ job-management requests.
 *
 * These schemas validate and normalize client input only. Job ownership,
 * lifecycle transitions, retry eligibility, and persistence rules belong to
 * the service and repository layers.
 */

import { z } from 'zod';

const JOB_TYPES = ['EMAIL', 'WEBHOOK', 'REPORT_GENERATION'];

const JOB_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const JOB_STATUSES = [
  'SCHEDULED',
  'QUEUED',
  'PROCESSING',
  'RETRYING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER',
  'CANCELLED',
];

/**
 * Validates an ISO date-time and converts it to a Date instance.
 */
const optionalAvailableAtSchema = z.iso
  .datetime({
    offset: true,
    message: 'availableAt must be a valid ISO 8601 date-time.',
  })
  .transform((value) => new Date(value))
  .optional();

/**
 * Validates job creation input.
 */
export const createJobSchema = z.object({
  type: z.enum(JOB_TYPES),

  priority: z.enum(JOB_PRIORITIES).default('MEDIUM'),

  payload: z
    .record(z.string(), z.unknown())
    .refine((payload) => Object.keys(payload).length > 0, 'Job payload cannot be empty.'),

  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'Idempotency key cannot be empty.')
    .max(255, 'Idempotency key cannot exceed 255 characters.')
    .optional(),

  maxAttempts: z.coerce
    .number()
    .int()
    .min(1, 'maxAttempts must be at least 1.')
    .max(10, 'maxAttempts cannot exceed 10.')
    .default(3),

  availableAt: optionalAvailableAtSchema,
});

/**
 * Validates filters and pagination for a user's job list.
 */
export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  status: z.enum(JOB_STATUSES).optional(),

  type: z.enum(JOB_TYPES).optional(),
});

/**
 * Validates a job identifier supplied through route parameters.
 */
export const jobIdParamsSchema = z.object({
  jobId: z.uuid('jobId must be a valid UUID.'),
});
