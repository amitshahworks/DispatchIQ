/**
 * @file worker-flow.integration.js
 * @description End-to-end integration test for the DispatchIQ job lifecycle.
 *
 * This suite verifies the complete production-oriented flow:
 *
 * 1. A real authenticated HTTP request creates a job.
 * 2. PostgreSQL persists the queued job.
 * 3. A real worker instance claims it using FOR UPDATE SKIP LOCKED.
 * 4. The matching handler executes.
 * 5. The job, attempt, and lifecycle logs are persisted.
 * 6. The authenticated API returns the completed job.
 *
 * The test creates uniquely identifiable records and removes only those
 * records during cleanup. It does not reset or reseed the development
 * database.
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
 * The real worker entrypoint registers SIGINT and SIGTERM handlers. The
 * integration test does not need to modify process-level signal listeners, so
 * this adapter safely accepts registration and removal operations.
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
  const idempotencyKey = `worker-flow-${testRunId}`;

  const app = createApp();

  let userId;
  let jobId;
  let workerId;
  let accessToken;
  let workerProcess;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: testEmail,

        /*
         * Authentication is performed with a directly generated JWT in this
         * integration test, so this non-login password hash is never verified.
         * The column remains populated to satisfy the database contract.
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
        pollIntervalMs: 60_000,
        heartbeatIntervalMs: 60_000,
        retryBaseDelayMs: 10,
        retryMaxDelayMs: 100,

        /*
         * Recovery remains enabled during integration testing, but the intervals
         * are intentionally long so background recovery cannot interfere with the
         * deterministic single-job execution exercised by this suite.
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
  });

  afterAll(async () => {
    /*
     * Stop runtime timers and persist the worker's graceful OFFLINE state
     * before removing integration records.
     */
    if (workerProcess?.isStarted()) {
      await workerProcess.shutdown('INTEGRATION_TEST');
    }

    if (jobId) {
      await prisma.jobLog.deleteMany({
        where: {
          jobId,
        },
      });

      await prisma.jobAttempt.deleteMany({
        where: {
          jobId,
        },
      });

      await prisma.job.deleteMany({
        where: {
          id: jobId,
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

  it('creates, claims, executes, and completes an EMAIL job', async () => {
    const createResponse = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'EMAIL',
        priority: 'HIGH',
        payload: {
          to: 'integration-recipient@example.com',
          subject: 'DispatchIQ integration test',
          body: 'This job verifies the full worker execution flow.',
        },
        idempotencyKey,
        maxAttempts: 3,

        /*
         * A deterministic early availability time ensures this integration
         * record wins claim ordering without modifying unrelated queued jobs.
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
        idempotencyKey,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    jobId = createResponse.body.data.id;

    expect(jobId).toEqual(expect.any(String));

    const worker = await workerProcess.start();

    workerId = worker.id;

    expect(worker).toMatchObject({
      hostname: `integration-worker-${testRunId}`,
      status: 'ONLINE',
    });

    /*
     * The configured polling interval is intentionally long. Calling pollNow
     * directly gives this integration test deterministic execution timing.
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
