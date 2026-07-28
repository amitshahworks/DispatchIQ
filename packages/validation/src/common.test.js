import { describe, expect, it } from 'vitest';

import { idParamSchema, paginationQuerySchema } from './common.js';

describe('common validation schemas', () => {
  it('accepts a non-empty ID', () => {
    const result = idParamSchema.parse({ id: 'job-123' });

    expect(result.id).toBe('job-123');
  });

  it('rejects an empty ID', () => {
    expect(() => idParamSchema.parse({ id: '   ' })).toThrow();
  });

  it('applies pagination defaults', () => {
    const result = paginationQuerySchema.parse({});

    expect(result).toEqual({
      page: 1,
      limit: 20,
    });
  });

  it('coerces valid pagination query strings', () => {
    const result = paginationQuerySchema.parse({
      page: '2',
      limit: '50',
    });

    expect(result).toEqual({
      page: 2,
      limit: 50,
    });
  });

  it('rejects limits above the maximum', () => {
    expect(() => paginationQuerySchema.parse({ limit: 101 })).toThrow();
  });
});
