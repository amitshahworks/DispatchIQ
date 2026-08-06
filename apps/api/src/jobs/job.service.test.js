/**
 * @file job.service.test.js
 * @description Unit tests for DispatchIQ job-management business logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJobRecordMock = vi.fn();
const findJobByIdempotencyKeyMock = vi.fn();
const findJobByIdForUserMock = vi.fn();
const findJobDetailsByIdForUserMock = vi.fn();
const findJobsForUserMock = vi.fn();
const countJobsForUserMock = vi.fn();
const transitionJobStatusMock = vi.fn();

vi.mock('./job.repository.js', () => ({
  createJob: createJobRecordMock,
  findJobByIdempotencyKey: findJobByIdempotencyKeyMock,
  findJobByIdForUser: findJobByIdForUserMock,
  findJobDetailsByIdForUser: findJobDetailsByIdForUserMock,
  findJobsForUser: findJobsForUserMock,
  countJobsForUser: countJobsForUserMock,
  transitionJobStatus: transitionJobStatusMock,
}));

const { cancelJob, createJob, getJob, listJobs } = await import('./job.service.js');

describe('job service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    const now = new Date('2026-08-06T10:00:00.000Z');

    it('creates an immediately available job with QUEUED status', async () => {
      const input = {
        type: 'EMAIL',
        priority: 'MEDIUM',
        payload: {
          to: 'amit@example.com',
        },
        maxAttempts: 3,
      };

      const createdJob = {
        id: 'job-123',
        userId: 'user-123',
        status: 'QUEUED',
        ...input,
        availableAt: now,
      };

      createJobRecordMock.mockResolvedValue(createdJob);

      const result = await createJob('user-123', input, now);

      expect(createJobRecordMock).toHaveBeenCalledWith({
        userId: 'user-123',
        type: 'EMAIL',
        status: 'QUEUED',
        priority: 'MEDIUM',
        payload: {
          to: 'amit@example.com',
        },
        idempotencyKey: undefined,
        maxAttempts: 3,
        availableAt: now,
      });

      expect(result).toEqual(createdJob);
    });

    it('creates a future job with SCHEDULED status', async () => {
      const availableAt = new Date('2026-08-07T10:00:00.000Z');

      createJobRecordMock.mockResolvedValue({
        id: 'job-123',
        status: 'SCHEDULED',
      });

      await createJob(
        'user-123',
        {
          type: 'REPORT_GENERATION',
          priority: 'HIGH',
          payload: {
            report: 'monthly',
          },
          maxAttempts: 5,
          availableAt,
        },
        now,
      );

      expect(createJobRecordMock).toHaveBeenCalledWith({
        userId: 'user-123',
        type: 'REPORT_GENERATION',
        status: 'SCHEDULED',
        priority: 'HIGH',
        payload: {
          report: 'monthly',
        },
        idempotencyKey: undefined,
        maxAttempts: 5,
        availableAt,
      });
    });

    it('returns an existing job when the idempotency key was already used', async () => {
      const existingJob = {
        id: 'existing-job',
        userId: 'user-123',
        idempotencyKey: 'request-001',
      };

      findJobByIdempotencyKeyMock.mockResolvedValue(existingJob);

      const result = await createJob(
        'user-123',
        {
          type: 'WEBHOOK',
          priority: 'LOW',
          payload: {
            url: 'https://example.com/webhook',
          },
          idempotencyKey: 'request-001',
          maxAttempts: 3,
        },
        now,
      );

      expect(findJobByIdempotencyKeyMock).toHaveBeenCalledWith({
        userId: 'user-123',
        idempotencyKey: 'request-001',
      });

      expect(createJobRecordMock).not.toHaveBeenCalled();
      expect(result).toEqual(existingJob);
    });

    it('creates a job when the idempotency key has not been used', async () => {
      findJobByIdempotencyKeyMock.mockResolvedValue(null);
      createJobRecordMock.mockResolvedValue({
        id: 'new-job',
      });

      await createJob(
        'user-123',
        {
          type: 'WEBHOOK',
          priority: 'MEDIUM',
          payload: {
            url: 'https://example.com/webhook',
          },
          idempotencyKey: 'request-002',
          maxAttempts: 3,
        },
        now,
      );

      expect(createJobRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'request-002',
        }),
      );
    });
  });

  describe('getJob', () => {
    it('returns user-owned job details', async () => {
      const job = {
        id: 'job-123',
        userId: 'user-123',
        attempts: [],
        logs: [],
      };

      findJobDetailsByIdForUserMock.mockResolvedValue(job);

      const result = await getJob('user-123', 'job-123');

      expect(findJobDetailsByIdForUserMock).toHaveBeenCalledWith({
        userId: 'user-123',
        jobId: 'job-123',
      });

      expect(result).toEqual(job);
    });

    it('returns 404 when the job does not exist for the user', async () => {
      findJobDetailsByIdForUserMock.mockResolvedValue(null);

      await expect(getJob('user-123', 'unknown-job')).rejects.toMatchObject({
        statusCode: 404,
        code: 'JOB_NOT_FOUND',
      });
    });
  });

  describe('listJobs', () => {
    it('returns filtered jobs with pagination metadata', async () => {
      const items = [
        {
          id: 'job-1',
        },
        {
          id: 'job-2',
        },
      ];

      findJobsForUserMock.mockResolvedValue(items);
      countJobsForUserMock.mockResolvedValue(42);

      const result = await listJobs('user-123', {
        page: 2,
        limit: 20,
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(findJobsForUserMock).toHaveBeenCalledWith({
        userId: 'user-123',
        skip: 20,
        take: 20,
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(countJobsForUserMock).toHaveBeenCalledWith({
        userId: 'user-123',
        status: 'FAILED',
        type: 'WEBHOOK',
      });

      expect(result).toEqual({
        items,
        pagination: {
          page: 2,
          limit: 20,
          totalItems: 42,
          totalPages: 3,
        },
      });
    });

    it('returns zero total pages when no jobs match', async () => {
      findJobsForUserMock.mockResolvedValue([]);
      countJobsForUserMock.mockResolvedValue(0);

      const result = await listJobs('user-123', {
        page: 1,
        limit: 20,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 0,
      });
    });
  });

  describe('cancelJob', () => {
    const cancelledAt = new Date('2026-08-06T11:00:00.000Z');

    it.each(['SCHEDULED', 'QUEUED', 'RETRYING'])('cancels a job in %s status', async (status) => {
      findJobByIdForUserMock
        .mockResolvedValueOnce({
          id: 'job-123',
          userId: 'user-123',
          status,
        })
        .mockResolvedValueOnce({
          id: 'job-123',
          userId: 'user-123',
          status: 'CANCELLED',
          cancelledAt,
        });

      transitionJobStatusMock.mockResolvedValue({
        count: 1,
      });

      const result = await cancelJob('user-123', 'job-123', cancelledAt);

      expect(transitionJobStatusMock).toHaveBeenCalledWith({
        userId: 'user-123',
        jobId: 'job-123',
        expectedStatuses: ['SCHEDULED', 'QUEUED', 'RETRYING'],
        status: 'CANCELLED',
        data: {
          cancelledAt,
          lockedAt: null,
          lockedByWorkerId: null,
        },
      });

      expect(result).toMatchObject({
        status: 'CANCELLED',
        cancelledAt,
      });
    });

    it('returns 404 when the job does not exist for the user', async () => {
      findJobByIdForUserMock.mockResolvedValue(null);

      await expect(cancelJob('user-123', 'unknown-job', cancelledAt)).rejects.toMatchObject({
        statusCode: 404,
        code: 'JOB_NOT_FOUND',
      });

      expect(transitionJobStatusMock).not.toHaveBeenCalled();
    });

    it.each(['PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED'])(
      'rejects cancellation for a job in %s status',
      async (status) => {
        findJobByIdForUserMock.mockResolvedValue({
          id: 'job-123',
          userId: 'user-123',
          status,
        });

        await expect(cancelJob('user-123', 'job-123', cancelledAt)).rejects.toMatchObject({
          statusCode: 409,
          code: 'JOB_NOT_CANCELLABLE',
          details: {
            currentStatus: status,
          },
        });

        expect(transitionJobStatusMock).not.toHaveBeenCalled();
      },
    );

    it('returns a conflict when the job changes state concurrently', async () => {
      findJobByIdForUserMock.mockResolvedValue({
        id: 'job-123',
        userId: 'user-123',
        status: 'QUEUED',
      });

      transitionJobStatusMock.mockResolvedValue({
        count: 0,
      });

      await expect(cancelJob('user-123', 'job-123', cancelledAt)).rejects.toMatchObject({
        statusCode: 409,
        code: 'JOB_STATE_CONFLICT',
      });
    });
  });
});
