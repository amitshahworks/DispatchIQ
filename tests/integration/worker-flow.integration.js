/**
 * @file worker-flow.integration.js
 * @description End-to-end integration tests for DispatchIQ authentication,
 * job submission, PostgreSQL persistence, and distributed worker execution.
 *
 * This suite verifies two production-oriented submission paths:
 *
 * 1. JWT-authenticated interactive clients can create jobs.
 * 2. API-key-authenticated programmatic clients can create jobs.
 *
 * Both paths continue through the same execution pipeline:
 *
 * HTTP request
 *   → authenticated user resolution
 *   → job persistence
 *   → PostgreSQL worker claim using FOR UPDATE SKIP LOCKED
 *   → handler execution
 *   → attempt and lifecycle-log persistence
 *   → COMPLETED job state
 *
 * Integration records are uniquely identified and selectively removed during
 * cleanup. The suite does not reset or reseed the development database.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@dispatchiq/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../apps/api/src/app.js';
import { generateAccessToken } from '../../apps/api/src/auth/auth.tokens.js';
import { createWorkerProcess } from '../../apps/worker/src/worker.js';

const TEST_AVAILABLE_AT = new Date('2000-01-01T00:00:00.000Z');

const silentLogger = Object.freeze({
  info() {},
  error() {},
});

/**
 * Creates a minimal process-event adapter for worker integration testing.
 *
 * The real worker entrypoint registers SIGINT and SIGTERM handlers. Integration
 * tests must not modify process-level signal listeners, so this adapter safely
 * accepts listener registration and removal operations.
 *
 * @returns {{
 *   once: () => void,
 *   removeListener: () => void
 * }} Process-event adapter.
 */
function createProcessAdapter() {
  return {
    once() {},
    removeListener() {},
  };
}

describe('API to PostgreSQL to worker integration', () => {
  const testRunId = randomUUID();

  const testEmail = `worker-flow-${testRunId}@dispatchiq.test`;

  const jwtIdempotencyKey = `worker-flow-jwt-${testRunId}`;

  const apiKeyIdempotencyKey = `worker-flow-api-key-${testRunId}`;

  const app = createApp();

  const jobIds = [];

  let userId;
  let workerId;
  let accessToken;
  let workerProcess;
  let rawApiKey;
  let persistedApiKeyId;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: testEmail,

        /*
         * Authentication is performed with a directly generated JWT in this
         * integration suite, so this non-login password hash is never
         * verified. The value exists only to satisfy the database contract.
         */
        passwordHash: `integration-only-${testRunId}`,

        role: 'USER',
      },
    });

    userId = user.id;

    accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
    });

    workerProcess = createWorkerProcess({
      config: {
        hostname: `integration-worker-${testRunId}`,

        /*
         * Automatic polling remains intentionally slow. Tests call pollNow()
         * explicitly so execution timing remains deterministic.
         */
        pollIntervalMs: 60_000,
        heartbeatIntervalMs: 60_000,

        retryBaseDelayMs: 10,
        retryMaxDelayMs: 100,

        /*
         * Recovery remains enabled so the integration runtime matches normal
         * production architecture, but long intervals prevent recovery work
         * from interfering with deterministic test execution.
         */
        recoveryIntervalMs: 120_000,
        staleAfterMs: 180_000,
        recoveryBatchLimit: 100,
      },

      processRef: createProcessAdapter(),
      logger: silentLogger,

      databaseClient: {
        async $disconnect() {},
      },
    });

    /*
     * A single real worker process is shared by both authentication scenarios.
     * Each test explicitly invokes pollNow() after creating its own job.
     */
    const worker = await workerProcess.start();

    workerId = worker.id;

    expect(worker).toMatchObject({
      hostname: `integration-worker-${testRunId}`,
      status: 'ONLINE',
    });
  });

  afterAll(async () => {
    /*
     * Stop runtime timers and persist the worker's graceful OFFLINE lifecycle
     * state before deleting integration records.
     */
    if (workerProcess?.isStarted()) {
      await workerProcess.shutdown('INTEGRATION_TEST');
    }

    if (jobIds.length > 0) {
      await prisma.jobLog.deleteMany({
        where: {
          jobId: {
            in: jobIds,
          },
        },
      });

      await prisma.jobAttempt.deleteMany({
        where: {
          jobId: {
            in: jobIds,
          },
        },
      });

      await prisma.job.deleteMany({
        where: {
          id: {
            in: jobIds,
          },
        },
      });
    }

    if (workerId) {
      await prisma.workerInstance.deleteMany({
        where: {
          id: workerId,
        },
      });
    }

    if (userId) {
      await prisma.refreshToken.deleteMany({
        where: {
          userId,
        },
      });

      await prisma.apiKey.deleteMany({
        where: {
          userId,
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: userId,
        },
      });
    }

    await prisma.$disconnect();
  });

  it('creates, claims, executes, and completes an EMAIL job using JWT authentication', async () => {
    const createResponse = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'EMAIL',
        priority: 'HIGH',

        payload: {
          to: 'integration-recipient@example.com',
          subject: 'DispatchIQ JWT integration test',
          body: 'This job verifies the JWT worker execution flow.',
        },

        idempotencyKey: jwtIdempotencyKey,
        maxAttempts: 3,

        /*
         * A deterministic early availability timestamp ensures the integration
         * job is immediately eligible for worker claiming.
         */
        availableAt: TEST_AVAILABLE_AT.toISOString(),
      });

    expect(createResponse.status).toBe(201);

    expect(createResponse.body).toMatchObject({
      success: true,

      data: {
        userId,
        type: 'EMAIL',
        status: 'QUEUED',
        priority: 'HIGH',
        idempotencyKey: jwtIdempotencyKey,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    const jobId = createResponse.body.data.id;

    expect(jobId).toEqual(expect.any(String));

    jobIds.push(jobId);

    /*
     * Explicit polling avoids waiting for the worker's configured background
     * polling interval.
     */
    await workerProcess.getRuntime().pollNow();

    const persistedJob = await prisma.job.findUnique({
      where: {
        id: jobId,
      },

      include: {
        attempts: {
          orderBy: {
            attemptNumber: 'asc',
          },
        },

        logs: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    expect(persistedJob).not.toBeNull();

    expect(persistedJob).toMatchObject({
      id: jobId,
      userId,
      status: 'COMPLETED',
      attemptCount: 1,
      lockedAt: null,
      lockedByWorkerId: null,
      lastError: null,
    });

    expect(persistedJob.completedAt).toBeInstanceOf(Date);

    expect(persistedJob.attempts).toHaveLength(1);

    expect(persistedJob.attempts[0]).toMatchObject({
      jobId,
      attemptNumber: 1,
      status: 'COMPLETED',
      workerInstanceId: workerId,
      error: null,
    });

    expect(persistedJob.attempts[0].finishedAt).toBeInstanceOf(Date);

    expect(persistedJob.attempts[0].durationMs).toEqual(expect.any(Number));

    expect(persistedJob.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining(['JOB_QUEUED', 'JOB_PROCESSING', 'JOB_COMPLETED']),
    );

    /*
     * Job inspection remains JWT-only even though creation supports unified
     * authentication.
     */
    const detailResponse = await request(app)
      .get(`/api/v1/jobs/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailResponse.status).toBe(200);

    expect(detailResponse.body).toMatchObject({
      success: true,

      data: {
        id: jobId,
        userId,
        status: 'COMPLETED',
        attemptCount: 1,
      },
    });

    expect(detailResponse.body.data.attempts).toHaveLength(1);

    expect(detailResponse.body.data.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining(['JOB_QUEUED', 'JOB_PROCESSING', 'JOB_COMPLETED']),
    );
  });

  it('creates an API key and uses it to submit, execute, and complete an EMAIL job', async () => {
    /*
     * API-key management remains JWT-only. A real authenticated management
     * request creates the credential so this scenario verifies the complete
     * credential-generation and persistence path before machine authentication
     * is exercised.
     */
    const apiKeyResponse = await request(app)
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Integration API Key ${testRunId}`,
      });

    expect(apiKeyResponse.status).toBe(201);

    expect(apiKeyResponse.body).toMatchObject({
      success: true,

      data: {
        apiKey: {
          userId,
          name: `Integration API Key ${testRunId}`,
          lastUsedAt: null,
          revokedAt: null,
        },

        key: expect.stringMatching(/^diq_live_[A-Za-z0-9_-]{43}$/),
      },
    });

    rawApiKey = apiKeyResponse.body.data.key;
    persistedApiKeyId = apiKeyResponse.body.data.apiKey.id;

    expect(rawApiKey).toEqual(expect.any(String));

    /*
     * Submit a real job using only the API key. No JWT is supplied. The
     * unified authentication middleware must therefore select X-API-Key
     * authentication, resolve the owning user, and preserve that ownership
     * through job creation.
     */
    const createResponse = await request(app)
      .post('/api/v1/jobs')
      .set('X-API-Key', rawApiKey)
      .send({
        type: 'EMAIL',
        priority: 'HIGH',

        payload: {
          to: 'api-key-integration@example.com',
          subject: 'DispatchIQ API key integration test',
          body: 'This job verifies machine-to-machine job submission.',
        },

        idempotencyKey: apiKeyIdempotencyKey,

        maxAttempts: 3,

        availableAt: TEST_AVAILABLE_AT.toISOString(),
      });

    expect(createResponse.status).toBe(201);

    expect(createResponse.body).toMatchObject({
      success: true,

      data: {
        userId,
        type: 'EMAIL',
        status: 'QUEUED',
        priority: 'HIGH',
        idempotencyKey: apiKeyIdempotencyKey,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    const jobId = createResponse.body.data.id;

    expect(jobId).toEqual(expect.any(String));

    jobIds.push(jobId);

    /*
     * Successful API-key authentication must update lastUsedAt without
     * exposing or replacing credential material.
     */
    const persistedApiKey = await prisma.apiKey.findUnique({
      where: {
        id: persistedApiKeyId,
      },
    });

    expect(persistedApiKey).not.toBeNull();

    expect(persistedApiKey.lastUsedAt).toBeInstanceOf(Date);

    expect(persistedApiKey.revokedAt).toBeNull();

    /*
     * Drive one deterministic worker poll and verify the exact same execution
     * pipeline used by JWT-submitted jobs.
     */
    await workerProcess.getRuntime().pollNow();

    const persistedJob = await prisma.job.findUnique({
      where: {
        id: jobId,
      },

      include: {
        attempts: {
          orderBy: {
            attemptNumber: 'asc',
          },
        },

        logs: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    expect(persistedJob).not.toBeNull();

    expect(persistedJob).toMatchObject({
      id: jobId,
      userId,
      status: 'COMPLETED',
      attemptCount: 1,
      lockedAt: null,
      lockedByWorkerId: null,
      lastError: null,
    });

    expect(persistedJob.completedAt).toBeInstanceOf(Date);

    expect(persistedJob.attempts).toHaveLength(1);

    expect(persistedJob.attempts[0]).toMatchObject({
      jobId,
      attemptNumber: 1,
      status: 'COMPLETED',
      workerInstanceId: workerId,
      error: null,
    });

    expect(persistedJob.attempts[0].finishedAt).toBeInstanceOf(Date);

    expect(persistedJob.attempts[0].durationMs).toEqual(expect.any(Number));

    expect(persistedJob.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining(['JOB_QUEUED', 'JOB_PROCESSING', 'JOB_COMPLETED']),
    );

    /*
     * Job-detail access intentionally remains JWT-only. Use the original
     * access token to confirm that the API-key-created job belongs to the same
     * user account and remains fully visible through normal account APIs.
     */
    const detailResponse = await request(app)
      .get(`/api/v1/jobs/${jobId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(detailResponse.status).toBe(200);

    expect(detailResponse.body).toMatchObject({
      success: true,

      data: {
        id: jobId,
        userId,
        status: 'COMPLETED',
        attemptCount: 1,
      },
    });

    expect(detailResponse.body.data.attempts).toHaveLength(1);

    expect(detailResponse.body.data.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining(['JOB_QUEUED', 'JOB_PROCESSING', 'JOB_COMPLETED']),
    );
  });
});
