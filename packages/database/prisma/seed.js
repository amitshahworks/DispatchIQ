/**
 * DispatchIQ development database seed.
 *
 * Populates the local database with deterministic users, workers, jobs,
 * attempts, logs, and an API key for development and dashboard testing.
 *
 * The seed intentionally excludes refresh tokens because authentication
 * session management has not been implemented yet.
 */

import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

import {
  AttemptStatus,
  JobPriority,
  JobStatus,
  JobType,
  LogEvent,
  LogLevel,
  PrismaClient,
  UserRole,
  WorkerStatus,
} from '../generated/prisma/client.ts';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const DEMO_PASSWORD = 'DispatchIQ@123';
const PASSWORD_SALT_ROUNDS = 12;

const now = new Date();

const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60 * 1000);

const minutesFromNow = (minutes) => new Date(now.getTime() + minutes * 60 * 1000);

/**
 * Removes existing development data in dependency-safe order.
 *
 * This makes the seed repeatable and prevents duplicate demo records.
 *
 * @returns {Promise<void>}
 */
async function clearDatabase() {
  await prisma.jobLog.deleteMany();
  await prisma.jobAttempt.deleteMany();
  await prisma.job.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.workerInstance.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Creates deterministic development users.
 *
 * @returns {Promise<{
 *   admin: import('../generated/prisma/client.ts').User;
 *   developer: import('../generated/prisma/client.ts').User;
 *   operator: import('../generated/prisma/client.ts').User;
 * }>}
 */
async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, PASSWORD_SALT_ROUNDS);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@dispatchiq.dev',
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  const developer = await prisma.user.create({
    data: {
      email: 'developer@dispatchiq.dev',
      passwordHash,
      role: UserRole.USER,
    },
  });

  const operator = await prisma.user.create({
    data: {
      email: 'operator@dispatchiq.dev',
      passwordHash,
      role: UserRole.USER,
    },
  });

  return {
    admin,
    developer,
    operator,
  };
}

/**
 * Creates representative worker processes with different health states.
 *
 * @returns {Promise<{
 *   primary: import('../generated/prisma/client.ts').WorkerInstance;
 *   secondary: import('../generated/prisma/client.ts').WorkerInstance;
 *   offline: import('../generated/prisma/client.ts').WorkerInstance;
 * }>}
 */
async function seedWorkers() {
  const primary = await prisma.workerInstance.create({
    data: {
      hostname: 'dispatchiq-worker-01',
      status: WorkerStatus.ONLINE,
      startedAt: minutesAgo(180),
      lastHeartbeatAt: minutesAgo(1),
    },
  });

  const secondary = await prisma.workerInstance.create({
    data: {
      hostname: 'dispatchiq-worker-02',
      status: WorkerStatus.BUSY,
      startedAt: minutesAgo(120),
      lastHeartbeatAt: minutesAgo(1),
    },
  });

  const offline = await prisma.workerInstance.create({
    data: {
      hostname: 'dispatchiq-worker-03',
      status: WorkerStatus.OFFLINE,
      startedAt: minutesAgo(1440),
      lastHeartbeatAt: minutesAgo(720),
      stoppedAt: minutesAgo(710),
    },
  });

  return {
    primary,
    secondary,
    offline,
  };
}

/**
 * Creates jobs representing the complete DispatchIQ lifecycle.
 *
 * @param {{
 *   admin: import('../generated/prisma/client.ts').User;
 *   developer: import('../generated/prisma/client.ts').User;
 *   operator: import('../generated/prisma/client.ts').User;
 * }} users Seeded users.
 * @param {{
 *   primary: import('../generated/prisma/client.ts').WorkerInstance;
 *   secondary: import('../generated/prisma/client.ts').WorkerInstance;
 * }} workers Seeded workers.
 * @returns {Promise<Array<import('../generated/prisma/client.ts').Job>>}
 */
async function seedJobs(users, workers) {
  const definitions = [
    {
      userId: users.admin.id,
      type: JobType.EMAIL,
      status: JobStatus.QUEUED,
      priority: JobPriority.HIGH,
      payload: {
        recipient: 'engineering@example.com',
        template: 'deployment-complete',
      },
      idempotencyKey: 'seed-email-queued-001',
      availableAt: minutesAgo(5),
    },
    {
      userId: users.developer.id,
      type: JobType.WEBHOOK,
      status: JobStatus.QUEUED,
      priority: JobPriority.MEDIUM,
      payload: {
        url: 'https://example.com/webhooks/orders',
        event: 'order.created',
      },
      idempotencyKey: 'seed-webhook-queued-001',
      availableAt: minutesAgo(2),
    },
    {
      userId: users.operator.id,
      type: JobType.REPORT_GENERATION,
      status: JobStatus.SCHEDULED,
      priority: JobPriority.LOW,
      payload: {
        reportType: 'weekly-operations',
        format: 'pdf',
      },
      idempotencyKey: 'seed-report-scheduled-001',
      availableAt: minutesFromNow(60),
    },
    {
      userId: users.admin.id,
      type: JobType.EMAIL,
      status: JobStatus.PROCESSING,
      priority: JobPriority.HIGH,
      payload: {
        recipient: 'alerts@example.com',
        template: 'system-alert',
      },
      idempotencyKey: 'seed-email-processing-001',
      attemptCount: 1,
      lockedAt: minutesAgo(1),
      lockedByWorkerId: workers.secondary.id,
    },
    {
      userId: users.developer.id,
      type: JobType.WEBHOOK,
      status: JobStatus.RETRYING,
      priority: JobPriority.HIGH,
      payload: {
        url: 'https://example.com/webhooks/billing',
        event: 'invoice.failed',
      },
      idempotencyKey: 'seed-webhook-retrying-001',
      attemptCount: 2,
      maxAttempts: 4,
      availableAt: minutesFromNow(10),
      lastError: 'Remote service returned HTTP 503.',
    },
    {
      userId: users.operator.id,
      type: JobType.REPORT_GENERATION,
      status: JobStatus.COMPLETED,
      priority: JobPriority.MEDIUM,
      payload: {
        reportType: 'monthly-summary',
        format: 'csv',
      },
      idempotencyKey: 'seed-report-completed-001',
      attemptCount: 1,
      completedAt: minutesAgo(20),
    },
    {
      userId: users.admin.id,
      type: JobType.EMAIL,
      status: JobStatus.COMPLETED,
      priority: JobPriority.LOW,
      payload: {
        recipient: 'welcome@example.com',
        template: 'welcome',
      },
      idempotencyKey: 'seed-email-completed-001',
      attemptCount: 1,
      completedAt: minutesAgo(45),
    },
    {
      userId: users.developer.id,
      type: JobType.WEBHOOK,
      status: JobStatus.FAILED,
      priority: JobPriority.MEDIUM,
      payload: {
        url: 'https://example.com/webhooks/inventory',
        event: 'stock.updated',
      },
      idempotencyKey: 'seed-webhook-failed-001',
      attemptCount: 3,
      lastError: 'Connection timed out after 30 seconds.',
    },
    {
      userId: users.operator.id,
      type: JobType.REPORT_GENERATION,
      status: JobStatus.DEAD_LETTER,
      priority: JobPriority.HIGH,
      payload: {
        reportType: 'financial-export',
        format: 'xlsx',
      },
      idempotencyKey: 'seed-report-dead-letter-001',
      attemptCount: 3,
      lastError: 'Report generation failed after maximum attempts.',
    },
    {
      userId: users.admin.id,
      type: JobType.EMAIL,
      status: JobStatus.CANCELLED,
      priority: JobPriority.MEDIUM,
      payload: {
        recipient: 'cancelled@example.com',
        template: 'unused-campaign',
      },
      idempotencyKey: 'seed-email-cancelled-001',
      cancelledAt: minutesAgo(30),
    },
    {
      userId: users.developer.id,
      type: JobType.REPORT_GENERATION,
      status: JobStatus.QUEUED,
      priority: JobPriority.HIGH,
      payload: {
        reportType: 'job-performance',
        format: 'json',
      },
      idempotencyKey: 'seed-report-queued-002',
      availableAt: minutesAgo(1),
    },
    {
      userId: users.operator.id,
      type: JobType.EMAIL,
      status: JobStatus.SCHEDULED,
      priority: JobPriority.MEDIUM,
      payload: {
        recipient: 'team@example.com',
        template: 'daily-digest',
      },
      idempotencyKey: 'seed-email-scheduled-002',
      availableAt: minutesFromNow(120),
    },
    {
      userId: users.admin.id,
      type: JobType.WEBHOOK,
      status: JobStatus.COMPLETED,
      priority: JobPriority.HIGH,
      payload: {
        url: 'https://example.com/webhooks/deployments',
        event: 'deployment.completed',
      },
      idempotencyKey: 'seed-webhook-completed-002',
      attemptCount: 2,
      completedAt: minutesAgo(90),
    },
    {
      userId: users.developer.id,
      type: JobType.EMAIL,
      status: JobStatus.RETRYING,
      priority: JobPriority.LOW,
      payload: {
        recipient: 'retry@example.com',
        template: 'notification',
      },
      idempotencyKey: 'seed-email-retrying-002',
      attemptCount: 1,
      availableAt: minutesFromNow(5),
      lastError: 'SMTP provider temporarily unavailable.',
    },
    {
      userId: users.operator.id,
      type: JobType.WEBHOOK,
      status: JobStatus.QUEUED,
      priority: JobPriority.LOW,
      payload: {
        url: 'https://example.com/webhooks/audit',
        event: 'audit.recorded',
      },
      idempotencyKey: 'seed-webhook-queued-003',
      availableAt: minutesAgo(3),
    },
  ];

  return Promise.all(
    definitions.map((data) =>
      prisma.job.create({
        data,
      }),
    ),
  );
}

/**
 * Adds execution attempts and lifecycle logs for jobs where processing has
 * already started or finished.
 *
 * @param {Array<import('../generated/prisma/client.ts').Job>} jobs Seeded jobs.
 * @param {{
 *   primary: import('../generated/prisma/client.ts').WorkerInstance;
 *   secondary: import('../generated/prisma/client.ts').WorkerInstance;
 *   offline: import('../generated/prisma/client.ts').WorkerInstance;
 * }} workers Seeded workers.
 * @returns {Promise<void>}
 */
async function seedJobHistory(jobs, workers) {
  const jobByKey = new Map(jobs.map((job) => [job.idempotencyKey, job]));

  const processingJob = jobByKey.get('seed-email-processing-001');
  const retryingJob = jobByKey.get('seed-webhook-retrying-001');
  const completedJob = jobByKey.get('seed-report-completed-001');
  const failedJob = jobByKey.get('seed-webhook-failed-001');
  const deadLetterJob = jobByKey.get('seed-report-dead-letter-001');

  await prisma.jobAttempt.createMany({
    data: [
      {
        jobId: processingJob.id,
        attemptNumber: 1,
        status: AttemptStatus.PROCESSING,
        workerInstanceId: workers.secondary.id,
        startedAt: minutesAgo(1),
      },
      {
        jobId: retryingJob.id,
        attemptNumber: 1,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.primary.id,
        startedAt: minutesAgo(25),
        finishedAt: minutesAgo(24),
        durationMs: 60_000,
        error: 'Remote service returned HTTP 503.',
      },
      {
        jobId: retryingJob.id,
        attemptNumber: 2,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.secondary.id,
        startedAt: minutesAgo(15),
        finishedAt: minutesAgo(14),
        durationMs: 60_000,
        error: 'Remote service returned HTTP 503.',
      },
      {
        jobId: completedJob.id,
        attemptNumber: 1,
        status: AttemptStatus.COMPLETED,
        workerInstanceId: workers.primary.id,
        startedAt: minutesAgo(22),
        finishedAt: minutesAgo(20),
        durationMs: 120_000,
      },
      {
        jobId: failedJob.id,
        attemptNumber: 1,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.primary.id,
        startedAt: minutesAgo(70),
        finishedAt: minutesAgo(69),
        durationMs: 60_000,
        error: 'Connection timed out after 30 seconds.',
      },
      {
        jobId: failedJob.id,
        attemptNumber: 2,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.secondary.id,
        startedAt: minutesAgo(60),
        finishedAt: minutesAgo(59),
        durationMs: 60_000,
        error: 'Connection timed out after 30 seconds.',
      },
      {
        jobId: failedJob.id,
        attemptNumber: 3,
        status: AttemptStatus.TIMED_OUT,
        workerInstanceId: workers.offline.id,
        startedAt: minutesAgo(50),
        finishedAt: minutesAgo(49),
        durationMs: 60_000,
        error: 'Connection timed out after 30 seconds.',
      },
      {
        jobId: deadLetterJob.id,
        attemptNumber: 1,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.primary.id,
        startedAt: minutesAgo(150),
        finishedAt: minutesAgo(148),
        durationMs: 120_000,
        error: 'Report renderer exited unexpectedly.',
      },
      {
        jobId: deadLetterJob.id,
        attemptNumber: 2,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.secondary.id,
        startedAt: minutesAgo(130),
        finishedAt: minutesAgo(128),
        durationMs: 120_000,
        error: 'Report renderer exited unexpectedly.',
      },
      {
        jobId: deadLetterJob.id,
        attemptNumber: 3,
        status: AttemptStatus.FAILED,
        workerInstanceId: workers.offline.id,
        startedAt: minutesAgo(110),
        finishedAt: minutesAgo(108),
        durationMs: 120_000,
        error: 'Report renderer exited unexpectedly.',
      },
    ],
  });

  await prisma.jobLog.createMany({
    data: [
      {
        jobId: processingJob.id,
        level: LogLevel.INFO,
        event: LogEvent.JOB_QUEUED,
        message: 'Job entered the processing queue.',
      },
      {
        jobId: processingJob.id,
        level: LogLevel.INFO,
        event: LogEvent.JOB_PROCESSING,
        message: 'Worker claimed the job for execution.',
        metadata: {
          workerHostname: 'dispatchiq-worker-02',
          attemptNumber: 1,
        },
      },
      {
        jobId: retryingJob.id,
        level: LogLevel.WARN,
        event: LogEvent.JOB_FAILED,
        message: 'Webhook delivery attempt failed.',
        metadata: {
          attemptNumber: 2,
          statusCode: 503,
        },
      },
      {
        jobId: retryingJob.id,
        level: LogLevel.INFO,
        event: LogEvent.JOB_RETRYING,
        message: 'Job scheduled for another retry.',
        metadata: {
          nextAttemptInMinutes: 10,
        },
      },
      {
        jobId: completedJob.id,
        level: LogLevel.INFO,
        event: LogEvent.JOB_PROCESSING,
        message: 'Report generation started.',
      },
      {
        jobId: completedJob.id,
        level: LogLevel.INFO,
        event: LogEvent.JOB_COMPLETED,
        message: 'Report generated successfully.',
        metadata: {
          format: 'csv',
        },
      },
      {
        jobId: failedJob.id,
        level: LogLevel.ERROR,
        event: LogEvent.JOB_FAILED,
        message: 'Job failed after all configured attempts.',
        metadata: {
          attempts: 3,
        },
      },
      {
        jobId: deadLetterJob.id,
        level: LogLevel.ERROR,
        event: LogEvent.JOB_DEAD_LETTERED,
        message: 'Job moved to the dead-letter queue.',
        metadata: {
          attempts: 3,
          reason: 'Maximum attempts exhausted',
        },
      },
    ],
  });
}

/**
 * Creates one hashed API key record for development.
 *
 * The raw development key is printed only during seeding and is never stored
 * directly in the database.
 *
 * @param {import('../generated/prisma/client.ts').User} admin Admin user.
 * @returns {Promise<string>} Raw development API key.
 */
async function seedApiKey(admin) {
  const rawApiKey = 'dispatchiq_dev_key_local_only';
  const keyHash = await bcrypt.hash(rawApiKey, PASSWORD_SALT_ROUNDS);

  await prisma.apiKey.create({
    data: {
      userId: admin.id,
      name: 'Local Development Key',
      keyHash,
    },
  });

  return rawApiKey;
}

/**
 * Runs the complete development seed.
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log('Seeding DispatchIQ development database...');

  await clearDatabase();

  const users = await seedUsers();
  const workers = await seedWorkers();
  const jobs = await seedJobs(users, workers);
  await seedJobHistory(jobs, workers);
  const rawApiKey = await seedApiKey(users.admin);

  console.log('Seed completed successfully.');
  console.log(`Users created: ${Object.keys(users).length}`);
  console.log(`Workers created: ${Object.keys(workers).length}`);
  console.log(`Jobs created: ${jobs.length}`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
  console.log(`Development API key: ${rawApiKey}`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
