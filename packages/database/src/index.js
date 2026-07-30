/**
 * Public exports for the shared DispatchIQ database package.
 *
 * Applications should import from this module instead of referencing
 * individual implementation files directly.
 */

export { prisma } from './client.js';
export { checkDatabaseHealth } from './health.js';
