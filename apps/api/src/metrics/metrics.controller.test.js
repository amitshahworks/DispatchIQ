/**
 * @file metrics.controller.test.js
 * @description Unit tests for the DispatchIQ platform metrics controller.
 *
 * The metrics service is mocked so these tests verify HTTP status codes,
 * response contracts, service delegation, and asynchronous error propagation
 * without performing database queries.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPlatformMetricsMock = vi.fn();

vi.mock('./metrics.service.js', () => ({
  getPlatformMetrics: getPlatformMetricsMock,
}));

const { getPlatformMetricsController } = await import('./metrics.controller.js');

/**
 * Creates a minimal Express response mock supporting chained status/json calls.
 *
 * @returns {{
 *   status: ReturnType<typeof vi.fn>,
 *   json: ReturnType<typeof vi.fn>
 * }} Response mock.
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

describe('metrics controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPlatformMetricsController', () => {
    it('returns platform metrics with HTTP 200', async () => {
      const metrics = {
        generatedAt: '2026-08-07T10:00:00.000Z',

        queue: {
          total: 25,
          scheduled: 2,
          queued: 4,
          processing: 3,
          retrying: 1,
          completed: 12,
          failed: 1,
          deadLetter: 1,
          cancelled: 1,
          pending: 7,
          claimable: 5,
          oldestClaimableJobAgeMs: 15_000,
        },

        workers: {
          total: 4,
          starting: 0,
          online: 2,
          busy: 1,
          unhealthy: 0,
          offline: 1,
          stopping: 0,
          active: 3,
          available: 2,
          stale: 0,
        },

        execution: {
          totalAttempts: 30,
          processing: 1,
          completed: 25,
          failed: 3,
          timedOut: 1,
          successRate: 86.21,
          failureRate: 10.34,
          timeoutRate: 3.45,
          averageDurationMs: 285.42,
          averageAttemptsPerJob: 1.2,
        },

        throughput: {
          lastHour: {
            jobsCreated: 5,
            jobsCompleted: 4,
            attemptsCreated: 6,
          },

          last24Hours: {
            jobsCreated: 40,
            jobsCompleted: 36,
            attemptsCreated: 48,
          },
        },
      };

      getPlatformMetricsMock.mockResolvedValue(metrics);

      const req = {};
      const res = createResponseMock();
      const next = vi.fn();

      await getPlatformMetricsController(req, res, next);

      expect(getPlatformMetricsMock).toHaveBeenCalledOnce();

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: metrics,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('delegates metrics generation without HTTP-specific arguments', async () => {
      getPlatformMetricsMock.mockResolvedValue({
        generatedAt: '2026-08-07T10:00:00.000Z',
      });

      const req = {
        user: {
          id: 'user-123',
          role: 'ADMIN',
        },
        query: {
          ignored: 'value',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await getPlatformMetricsController(req, res, next);

      expect(getPlatformMetricsMock).toHaveBeenCalledWith();
    });

    it('passes service failures to Express error handling', async () => {
      const error = new Error('Metrics database unavailable.');

      getPlatformMetricsMock.mockRejectedValue(error);

      const req = {};
      const res = createResponseMock();
      const next = vi.fn();

      await getPlatformMetricsController(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('does not write a partial response when the service rejects', async () => {
      getPlatformMetricsMock.mockRejectedValue(new Error('Metrics calculation failed.'));

      const res = createResponseMock();
      const next = vi.fn();

      await getPlatformMetricsController({}, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
