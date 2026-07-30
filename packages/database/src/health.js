/**
 * Database health utilities.
 *
 * Provides lightweight connectivity checks used by API health endpoints,
 * worker startup validation, and readiness probes.
 */

import { prisma } from './client.js';

/**
 * Verifies that the application can communicate with PostgreSQL.
 *
 * Executes a lightweight query against the database. Any connection,
 * authentication, or execution failure is caught internally so callers can
 * safely treat the result as a simple boolean health indicator.
 *
 * @returns {Promise<boolean>} True when the database responds successfully;
 * otherwise false.
 */
export async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
