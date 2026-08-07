/**
 * @file dashboard.controller.test.js
 * @description Unit tests for DispatchIQ administrative dashboard controllers.
 *
 * Dashboard services are mocked so these tests verify service delegation,
 * successful HTTP responses, response structure, and asynchronous error
 * propagation independently of dashboard business logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDashboardOverviewMock = vi.fn();
const getSystemHealthMock = vi.fn();

vi.mock('./dashboard.service.js', () => ({
  getDashboardOverview: getDashboardOverviewMock,
  getSystemHealth: getSystemHealthMock,
}));

const { getDashboardOverviewController, getSystemHealthController } =
  await import('./dashboard.controller.js');

/**
 * Creates a minimal Express response mock supporting chained status/json
 * operations.
 *
 * @returns {{
 *   status: ReturnType<typeof vi.fn>,
 *   json: ReturnType<typeof vi.fn>
 * }} Express-style response mock.
 */
function createResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);

  return res;
}

describe('dashboard controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDashboardOverviewController', () => {
    it('delegates dashboard overview generation to the service', async () => {
      const overview = {
        generatedAt: '2026-08-07T12:00:00.000Z',

        queue: {
          total: 100,
          pending: 5,
          claimable: 0,
        },

        workers: {
          total: 3,
          active: 3,
          available: 2,
          stale: 0,
        },

        execution: {
          successRate: 100,
          failureRate: 0,
          timeoutRate: 0,
        },

        throughput: {
          lastHour: {
            jobsCreated: 10,
            jobsCompleted: 12,
            attemptsCreated: 12,
          },
        },
      };

      getDashboardOverviewMock.mockResolvedValue(overview);

      const res = createResponse();
      const next = vi.fn();

      await getDashboardOverviewController({}, res, next);

      expect(getDashboardOverviewMock).toHaveBeenCalledOnce();

      expect(getDashboardOverviewMock).toHaveBeenCalledWith();

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: overview,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('returns an empty but valid dashboard overview', async () => {
      const overview = {
        generatedAt: '2026-08-07T12:00:00.000Z',

        queue: {
          total: 0,
          pending: 0,
          claimable: 0,
        },

        workers: {
          total: 0,
          active: 0,
          available: 0,
          stale: 0,
        },

        execution: {
          successRate: 0,
          failureRate: 0,
          timeoutRate: 0,
        },

        throughput: {
          lastHour: {
            jobsCreated: 0,
            jobsCompleted: 0,
            attemptsCreated: 0,
          },

          last24Hours: {
            jobsCreated: 0,
            jobsCompleted: 0,
            attemptsCreated: 0,
          },
        },
      };

      getDashboardOverviewMock.mockResolvedValue(overview);

      const res = createResponse();

      await getDashboardOverviewController({}, res, vi.fn());

      expect(res.json.mock.calls[0][0]).toEqual({
        success: true,
        data: overview,
      });
    });

    it('forwards dashboard service failures to centralized error handling', async () => {
      const error = new Error('Dashboard metrics unavailable.');

      getDashboardOverviewMock.mockRejectedValue(error);

      const res = createResponse();
      const next = vi.fn();

      await getDashboardOverviewController({}, res, next);

      expect(next).toHaveBeenCalledOnce();

      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();

      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getSystemHealthController', () => {
    it('delegates system-health generation to the service', async () => {
      const health = {
        generatedAt: '2026-08-07T12:00:00.000Z',

        status: 'healthy',

        queue: {
          status: 'healthy',
          claimable: 0,
          pending: 4,
          failed: 0,
          deadLetter: 0,
        },

        workers: {
          status: 'healthy',
          active: 3,
          stale: 0,
        },

        execution: {
          status: 'healthy',
          successRate: 100,
          failureRate: 0,
          timeoutRate: 0,
        },
      };

      getSystemHealthMock.mockResolvedValue(health);

      const res = createResponse();
      const next = vi.fn();

      await getSystemHealthController({}, res, next);

      expect(getSystemHealthMock).toHaveBeenCalledOnce();

      expect(getSystemHealthMock).toHaveBeenCalledWith();

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: health,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('returns degraded system health without converting it into an HTTP error', async () => {
      const health = {
        generatedAt: '2026-08-07T12:00:00.000Z',

        status: 'degraded',

        queue: {
          status: 'degraded',
          claimable: 8,
          pending: 8,
          failed: 0,
          deadLetter: 0,
        },

        workers: {
          status: 'healthy',
          active: 2,
          stale: 0,
        },

        execution: {
          status: 'healthy',
          successRate: 100,
          failureRate: 0,
          timeoutRate: 0,
        },
      };

      getSystemHealthMock.mockResolvedValue(health);

      const res = createResponse();

      await getSystemHealthController({}, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: true,

        data: {
          status: 'degraded',
        },
      });
    });

    it('returns critical system health as operational data rather than an HTTP failure', async () => {
      const health = {
        generatedAt: '2026-08-07T12:00:00.000Z',

        status: 'critical',

        queue: {
          status: 'critical',
          claimable: 20,
          pending: 20,
          failed: 0,
          deadLetter: 0,
        },

        workers: {
          status: 'critical',
          active: 0,
          stale: 0,
        },

        execution: {
          status: 'healthy',
          successRate: 100,
          failureRate: 0,
          timeoutRate: 0,
        },
      };

      getSystemHealthMock.mockResolvedValue(health);

      const res = createResponse();

      await getSystemHealthController({}, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json.mock.calls[0][0].data.status).toBe('critical');
    });

    it('forwards system-health service failures to centralized error handling', async () => {
      const error = new Error('System health unavailable.');

      getSystemHealthMock.mockRejectedValue(error);

      const res = createResponse();
      const next = vi.fn();

      await getSystemHealthController({}, res, next);

      expect(next).toHaveBeenCalledOnce();

      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();

      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
