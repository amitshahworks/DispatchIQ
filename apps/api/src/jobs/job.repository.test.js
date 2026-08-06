/**
 * @file job.repository.test.js
 * @description Unit tests for the DispatchIQ job repository's Prisma queries.
 *
 * Prisma is mocked so these tests verify query construction without requiring
 * a running PostgreSQL container.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobCreateMock = vi.fn();
const jobFindUniqueMock = vi.fn();
const jobFindFirstMock = vi.fn();
const jobFindManyMock = vi.fn();
const jobCountMock = vi.fn();
const jobUpdateManyMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    job: {
      create: jobCreateMock,
      findUnique: jobFindUniqueMock,
      findFirst: jobFindFirstMock,
      findMany: jobFindManyMock,
      count: jobCountMock,
      updateMany: jobUpdateManyMock,
    },
  },
}));

const {
  countJobsForUser,
  createJob,
  findJobByIdempotencyKey,
  findJobByIdForUser,
  findJobDetailsByIdForUser,
  findJobsForUser,
  transitionJobStatus,
} = await import('./job.repository.js');

describe('job repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    it('creates a job using service-prepared values', async () => {
      const availableAt = new Date('2026-08-10T09:00:00.000Z');

      const data = {
        userId: 'user-123',
        type: 'EMAIL',
        status: 'SCHEDULED',
        priority: 'HIGH',
        payload: {
          to: 'amit@example.com',
          subject: 'Scheduled email',
        },
        idempotencyKey: 'email-job-001',
        maxAttempts: 5,
        availableAt,
      };

      const createdJob = {
        id: 'job-123',
        ...data,
      };

      jobCreateMock.mockResolvedValue(createdJob);

      const result = await createJob(data);

      expect(jobCreateMock).toHaveBeenCalledWith({
        data,
      });

      expect(result).toEqual(createdJob);
    });

    it('creates a job without an idempotency key', async () => {
      const availableAt = new Date('2026-08-06T09:00:00.000Z');

      jobCreateMock.mockResolvedValue({
        id: 'job-123',
      });

      await createJob({
        userId: 'user-123',
        type: 'WEBHOOK',
        status: 'QUEUED',
        priority: 'MEDIUM',
        payload: {
          url: 'https://example.com/webhook',
        },
        maxAttempts: 3,
        availableAt,
      });

      expect(jobCreateMock).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          type: 'WEBHOOK',
          status: 'QUEUED',
          priority: 'MEDIUM',
          payload: {
            url: 'https://example.com/webhook',
          },
          idempotencyKey: undefined,
          maxAttempts: 3,
          availableAt,
        },
      });
    });
  });

  describe('findJobByIdempotencyKey', () => {
    it('uses the compound user and idempotency-key constraint', async () => {
      jobFindUniqueMock.mockResolvedValue({
        id: 'job-123',
      });

      await findJobByIdempotencyKey({
        userId: 'user-123',
        idempotencyKey: 'job-key-001',
      });

      expect(jobFindUniqueMock).toHaveBeenCalledWith({
        where: {
          userId_idempotencyKey: {
            userId: 'user-123',
            idempotencyKey: 'job-key-001',
          },
        },
      });
    });
  });

  describe('findJobByIdForUser', () => {
    it('enforces job ownership in the lookup query', async () => {
      jobFindFirstMock.mockResolvedValue({
        id: 'job-123',
        userId: 'user-123',
      });

      await findJobByIdForUser({
        jobId: 'job-123',
        userId: 'user-123',
      });

      expect(jobFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          userId: 'user-123',
        },
      });
    });
  });

  describe('findJobDetailsByIdForUser', () => {
    it('returns user-owned job details with ordered attempts and logs', async () => {
      jobFindFirstMock.mockResolvedValue({
        id: 'job-123',
        attempts: [],
        logs: [],
      });

      await findJobDetailsByIdForUser({
        jobId: 'job-123',
        userId: 'user-123',
      });

      expect(jobFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          userId: 'user-123',
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
    });
  });

  describe('findJobsForUser', () => {
    it('returns filtered user jobs ordered newest first', async () => {
      jobFindManyMock.mockResolvedValue([]);

      await findJobsForUser({
        userId: 'user-123',
        skip: 20,
        take: 20,
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(jobFindManyMock).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          status: 'FAILED',
          type: 'WEBHOOK',
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 20,
        take: 20,
      });
    });

    it('omits unused optional filters', async () => {
      jobFindManyMock.mockResolvedValue([]);

      await findJobsForUser({
        userId: 'user-123',
        skip: 0,
        take: 20,
      });

      expect(jobFindManyMock).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('countJobsForUser', () => {
    it('counts jobs using the same user-scoped filters', async () => {
      jobCountMock.mockResolvedValue(4);

      const count = await countJobsForUser({
        userId: 'user-123',
        status: 'COMPLETED',
        type: 'REPORT_GENERATION',
      });

      expect(jobCountMock).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          status: 'COMPLETED',
          type: 'REPORT_GENERATION',
        },
      });

      expect(count).toBe(4);
    });
  });

  describe('transitionJobStatus', () => {
    it('updates only a user-owned job in an expected status', async () => {
      const cancelledAt = new Date('2026-08-06T09:00:00.000Z');

      jobUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await transitionJobStatus({
        jobId: 'job-123',
        userId: 'user-123',
        expectedStatuses: ['SCHEDULED', 'QUEUED', 'RETRYING'],
        status: 'CANCELLED',
        data: {
          cancelledAt,
        },
      });

      expect(jobUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          userId: 'user-123',
          status: {
            in: ['SCHEDULED', 'QUEUED', 'RETRYING'],
          },
        },
        data: {
          cancelledAt,
          status: 'CANCELLED',
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });
  });
});
