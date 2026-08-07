/**
 * @file api-key.controller.test.js
 * @description Unit tests for DispatchIQ API-key management controllers.
 *
 * API-key services are mocked so these tests verify HTTP status codes,
 * authenticated-user propagation, validated request delegation, response
 * contracts, and asynchronous error forwarding independently of persistence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createApiKeyMock = vi.fn();
const listApiKeysMock = vi.fn();
const revokeApiKeyMock = vi.fn();

vi.mock('./api-key.service.js', () => ({
  createApiKey: createApiKeyMock,
  listApiKeys: listApiKeysMock,
  revokeApiKey: revokeApiKeyMock,
}));

const { createApiKeyController, listApiKeysController, revokeApiKeyController } =
  await import('./api-key.controller.js');

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

describe('API key controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApiKeyController', () => {
    it('creates an API key and returns HTTP 201', async () => {
      const result = {
        apiKey: {
          id: 'key-123',
          userId: 'user-123',
          name: 'CI deployment',
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-08-07T10:00:00.000Z'),
        },
        key: 'diq_live_secret',
      };

      createApiKeyMock.mockResolvedValue(result);

      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          name: 'CI deployment',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await createApiKeyController(req, res, next);

      expect(createApiKeyMock).toHaveBeenCalledWith('user-123', {
        name: 'CI deployment',
      });

      expect(res.status).toHaveBeenCalledWith(201);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: result,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards service failures to error middleware', async () => {
      const error = new Error('API key creation failed.');

      createApiKeyMock.mockRejectedValue(error);

      const req = {
        user: {
          id: 'user-123',
        },
        body: {
          name: 'CLI',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await createApiKeyController(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('listApiKeysController', () => {
    it('returns API-key metadata with HTTP 200', async () => {
      const apiKeys = [
        {
          id: 'key-123',
          userId: 'user-123',
          name: 'Production',
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-08-07T10:00:00.000Z'),
        },
      ];

      listApiKeysMock.mockResolvedValue(apiKeys);

      const req = {
        user: {
          id: 'user-123',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await listApiKeysController(req, res, next);

      expect(listApiKeysMock).toHaveBeenCalledWith('user-123');

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: apiKeys,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards listing failures to error middleware', async () => {
      const error = new Error('Database unavailable.');

      listApiKeysMock.mockRejectedValue(error);

      const req = {
        user: {
          id: 'user-123',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await listApiKeysController(req, res, next);

      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('revokeApiKeyController', () => {
    it('revokes a user-owned API key and returns HTTP 200', async () => {
      const revokedApiKey = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        userId: 'user-123',
        name: 'Production',
        lastUsedAt: null,
        revokedAt: new Date('2026-08-07T10:00:00.000Z'),
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
      };

      revokeApiKeyMock.mockResolvedValue(revokedApiKey);

      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          apiKeyId: '550e8400-e29b-41d4-a716-446655440000',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await revokeApiKeyController(req, res, next);

      expect(revokeApiKeyMock).toHaveBeenCalledWith(
        'user-123',
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(res.status).toHaveBeenCalledWith(200);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: revokedApiKey,
      });

      expect(next).not.toHaveBeenCalled();
    });

    it('forwards revocation failures to error middleware', async () => {
      const error = new Error('API key was not found.');

      revokeApiKeyMock.mockRejectedValue(error);

      const req = {
        user: {
          id: 'user-123',
        },
        params: {
          apiKeyId: '550e8400-e29b-41d4-a716-446655440000',
        },
      };

      const res = createResponseMock();
      const next = vi.fn();

      await revokeApiKeyController(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(error);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
