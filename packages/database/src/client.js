/**
 * @file client.js
 * @description Singleton Prisma Client for DispatchIQ, backed by the
 * PostgreSQL driver adapter (@prisma/adapter-pg). This is the only place in
 * the codebase that should construct a PrismaClient. apps/api and apps/worker
 * must import { prisma } from the shared database package instead of creating
 * their own client.
 */

import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { PrismaClient } from '../generated/prisma/client.ts';

const { Pool } = pg;

/**
 * Validates that DATABASE_URL is present before attempting to connect.
 *
 * @returns {string} The validated PostgreSQL connection string.
 * @throws {Error} When DATABASE_URL is missing or empty.
 */
function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Define it in your environment or .env file before starting the application.',
    );
  }

  return databaseUrl;
}

/**
 * Creates a PrismaClient backed by a PostgreSQL connection pool.
 *
 * @returns {PrismaClient} Configured Prisma client instance.
 */
function createPrismaClient() {
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
  });
}

const globalForPrisma = globalThis;

/**
 * Shared Prisma client for the current Node.js process.
 *
 * In non-production environments, the instance is cached on globalThis to
 * avoid creating duplicate connection pools during development reloads.
 *
 * @type {PrismaClient}
 */
export const prisma = globalForPrisma.__dispatchiqPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__dispatchiqPrisma__ = prisma;
}
