/**
 * @file vitest.integration.config.js
 * @description Vitest configuration for DispatchIQ integration tests.
 *
 * Integration tests use the real PostgreSQL database and are intentionally
 * excluded from the normal unit-test command. They execute sequentially to
 * prevent concurrent test workers from competing for queue records.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.integration.js'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
