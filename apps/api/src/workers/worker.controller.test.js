/**
 * @file worker.controller.test.js
 * @description Unit tests for DispatchIQ Worker Management API controllers.
 *
 * Worker services are mocked so these tests verify request delegation,
 * response status codes, response structure, validated parameter forwarding,
 * and asynchronous error propagation independently of business logic and
 * PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listWorkersMock = vi.fn();
const getWorkerMock = vi.fn();
const getWorkerHealthMock = vi.fn();

vi.mock('./worker.service.js', () => ({
  listWorkers: listWorkersMock,
  getWorker: getWorkerMock,
  getWorkerHealth: getWorkerHealthMock,
}));

const { getWorkerController, getWorkerHealthController, listWorkersController } =
  await import('./worker.controller.js');

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

describe('worker controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listWorkersController', () => {
    it('delegates validated query parameters to the worker service', async () => {
      const serviceResult = {
        workers: [],
        pagination: {
          page: 2,
          limit: 25,
          total: 0,
          totalPages: 0,
        },
      };

      listWorkersMock.mockResolvedValue(serviceResult);

      const req = {
        query: {
          page: 2,
          limit: 25,
          status: 'ONLINE',
        },
      };

      const res = createResponse();
      const next = vi.fn();

      await listWorkersController(req, res, next);

      expect(listWorkersMock).toHaveBeenCalledOnce();

      expect(listWorkersMock).toHaveBeenCalledWith({
        page: 2,
        limit: 25,
        status: 'ONLINE',
      });

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: serviceResult,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('supports listing requests containing only pagination defaults', async () => {
      listWorkersMock.mockResolvedValue({
        workers: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });

      const req = {
        query: {
          page: 1,
          limit: 20,
        },
      };

      const res = createResponse();

      await listWorkersController(req, res, vi.fn());

      expect(listWorkersMock).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
    });

    it('forwards service failures to centralized error handling', async () => {
      const error = new Error('Database unavailable.');

      listWorkersMock.mockRejectedValue(error);

      const req = {
        query: {
          page: 1,
          limit: 20,
        },
      };

      const res = createResponse();
      const next = vi.fn();

      await listWorkersController(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();

      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getWorkerController', () => {
    it('delegates the validated worker identifier to the service', async () => {
      const workerId = '123e4567-e89b-12d3-a456-426614174000';

      const worker = {
        id: workerId,
        hostname: 'worker-a',
        status: 'ONLINE',

        health: {
          heartbeatAgeMs: 10_000,
          isStale: false,
          health: 'healthy',
        },
      };

      getWorkerMock.mockResolvedValue(worker);

      const req = {
        params: {
          workerId,
        },
      };

      const res = createResponse();
      const next = vi.fn();

      await getWorkerController(req, res, next);

      expect(getWorkerMock).toHaveBeenCalledOnce();

      expect(getWorkerMock).toHaveBeenCalledWith(workerId);

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: worker,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards WORKER_NOT_FOUND errors from the service', async () => {
      const error = Object.assign(new Error('Worker was not found.'), {
        statusCode: 404,
        code: 'WORKER_NOT_FOUND',
      });

      getWorkerMock.mockRejectedValue(error);

      const req = {
        params: {
          workerId: '123e4567-e89b-12d3-a456-426614174000',
        },
      };

      const res = createResponse();
      const next = vi.fn();

      await getWorkerController(req, res, next);

      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();

      expect(res.json).not.toHaveBeenCalled();
    });

    it('forwards unexpected service errors without transforming them', async () => {
      const error = new Error('Unexpected repository failure.');

      getWorkerMock.mockRejectedValue(error);

      const req = {
        params: {
          workerId: '123e4567-e89b-12d3-a456-426614174000',
        },
      };

      const next = vi.fn();

      await getWorkerController(req, createResponse(), next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getWorkerHealthController', () => {
    it('returns cluster-level worker health', async () => {
      const health = {
        health: 'healthy',

        asOf: new Date('2026-08-07T12:00:00.000Z'),

        staleAfterMs: 60_000,

        workers: {
          active: 3,
          stale: 0,

          byStatus: {
            STARTING: 0,
            ONLINE: 2,
            BUSY: 1,
            UNHEALTHY: 0,
            OFFLINE: 1,
            STOPPING: 0,
          },
        },

        oldestActiveHeartbeat: {
          id: 'worker-1',
          hostname: 'worker-a',
          status: 'ONLINE',
          lastHeartbeatAt: new Date('2026-08-07T11:59:45.000Z'),
          heartbeatAgeMs: 15_000,
        },
      };

      getWorkerHealthMock.mockResolvedValue(health);

      const res = createResponse();
      const next = vi.fn();

      await getWorkerHealthController({}, res, next);

      expect(getWorkerHealthMock).toHaveBeenCalledOnce();

      expect(getWorkerHealthMock).toHaveBeenCalledWith();

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: health,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('supports unavailable cluster health responses', async () => {
      getWorkerHealthMock.mockResolvedValue({
        health: 'unavailable',
        workers: {
          active: 0,
          stale: 0,
        },
        oldestActiveHeartbeat: null,
      });

      const res = createResponse();

      await getWorkerHealthController({}, res, vi.fn());

      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: true,

        data: {
          health: 'unavailable',

          workers: {
            active: 0,
          },

          oldestActiveHeartbeat: null,
        },
      });
    });

    it('forwards worker-health service failures to centralized error handling', async () => {
      const error = new Error('Worker metrics query failed.');

      getWorkerHealthMock.mockRejectedValue(error);

      const res = createResponse();
      const next = vi.fn();

      await getWorkerHealthController({}, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();

      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
