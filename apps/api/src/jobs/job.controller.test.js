/**
 * @file job.controller.test.js
 * @description Unit tests for DispatchIQ job-management HTTP controllers.
 *
 * These tests verify that controllers pass authenticated user context and
 * validated request data to the job service, return the correct HTTP response
 * structure, and forward service failures to centralized error handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJobMock = vi.fn();
const listJobsMock = vi.fn();
const getJobMock = vi.fn();
const cancelJobMock = vi.fn();

vi.mock('./job.service.js', () => ({
  createJob: createJobMock,
  listJobs: listJobsMock,
  getJob: getJobMock,
  cancelJob: cancelJobMock,
}));

const { cancelJobController, createJobController, getJobController, listJobsController } =
  await import('./job.controller.js');

/**
 * Creates a minimal Express response mock with chainable status and JSON
 * methods.
 *
 * @returns {{
 *   status: ReturnType<typeof vi.fn>,
 *   json: ReturnType<typeof vi.fn>
 * }} Express-compatible response mock.
 */
function createResponseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);

  return response;
}

describe('job controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJobController', () => {
    it('creates a job for the authenticated user and returns HTTP 201', async () => {
      const requestBody = {
        type: 'EMAIL',
        priority: 'MEDIUM',
        payload: {
          to: 'amit@example.com',
          subject: 'Welcome',
        },
        maxAttempts: 3,
      };

      const createdJob = {
        id: 'job-123',
        userId: 'user-123',
        status: 'QUEUED',
        ...requestBody,
        availableAt: new Date('2026-08-06T10:00:00.000Z'),
      };

      createJobMock.mockResolvedValue(createdJob);

      const req = {
        user: {
          id: 'user-123',
          email: 'amit@example.com',
          role: 'USER',
        },
        body: requestBody,
      };

      const res = createResponseMock();
      const next = vi.fn();

      await createJobController(req, res, next);

      expect(createJobMock).toHaveBeenCalledOnce();
      expect(createJobMock).toHaveBeenCalledWith(req.user.id, requestBody);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: createdJob,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards job-creation failures to error middleware', async () => {
      const error = new Error('Job creation failed.');

      createJobMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await createJobController(
        {
          user: {
            id: 'user-123',
          },
          body: {
            type: 'EMAIL',
            priority: 'MEDIUM',
            payload: {
              to: 'amit@example.com',
            },
            maxAttempts: 3,
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('listJobsController', () => {
    it('returns the authenticated user jobs with HTTP 200', async () => {
      const query = {
        page: 2,
        limit: 20,
        status: 'FAILED',
        type: 'WEBHOOK',
      };

      const serviceResult = {
        items: [
          {
            id: 'job-1',
            status: 'FAILED',
            type: 'WEBHOOK',
          },
        ],
        pagination: {
          page: 2,
          limit: 20,
          totalItems: 21,
          totalPages: 2,
        },
      };

      listJobsMock.mockResolvedValue(serviceResult);

      const req = {
        user: {
          id: 'user-123',
        },
        query,
      };

      const res = createResponseMock();
      const next = vi.fn();

      await listJobsController(req, res, next);

      expect(listJobsMock).toHaveBeenCalledWith(req.user.id, query);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: serviceResult,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards job-listing failures to error middleware', async () => {
      const error = new Error('Job listing failed.');

      listJobsMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await listJobsController(
        {
          user: {
            id: 'user-123',
          },
          query: {
            page: 1,
            limit: 20,
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getJobController', () => {
    it('returns a user-owned job with HTTP 200', async () => {
      const job = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: 'user-123',
        status: 'COMPLETED',
        attempts: [],
        logs: [],
      };

      getJobMock.mockResolvedValue(job);

      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          jobId: job.id,
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await getJobController(req, res, next);

      expect(getJobMock).toHaveBeenCalledWith(req.user.id, job.id);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: job,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards missing-job errors to error middleware', async () => {
      const error = Object.assign(new Error('Job was not found.'), {
        statusCode: 404,
        code: 'JOB_NOT_FOUND',
      });

      getJobMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await getJobController(
        {
          user: {
            id: 'user-123',
          },
          params: {
            jobId: '123e4567-e89b-12d3-a456-426614174000',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('cancelJobController', () => {
    it('cancels a user-owned job and returns HTTP 200', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';

      const cancelledJob = {
        id: jobId,
        userId: 'user-123',
        status: 'CANCELLED',
        cancelledAt: new Date('2026-08-06T11:00:00.000Z'),
      };

      cancelJobMock.mockResolvedValue(cancelledJob);

      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          jobId,
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await cancelJobController(req, res, next);

      expect(cancelJobMock).toHaveBeenCalledWith(req.user.id, jobId);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: cancelledJob,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards cancellation conflicts to error middleware', async () => {
      const error = Object.assign(
        new Error('Job cannot be cancelled while in PROCESSING status.'),
        {
          statusCode: 409,
          code: 'JOB_NOT_CANCELLABLE',
        },
      );

      cancelJobMock.mockRejectedValue(error);

      const res = createResponseMock();
      const next = vi.fn();

      await cancelJobController(
        {
          user: {
            id: 'user-123',
          },
          params: {
            jobId: '123e4567-e89b-12d3-a456-426614174000',
          },
        },
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
