/**
 * Reusable validation schemas shared by DispatchIQ applications.
 */

import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().trim().min(1, 'ID is required'),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
