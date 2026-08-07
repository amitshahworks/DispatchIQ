/**
 * @file authenticate-api-key.test.js
 * @description Unit tests for DispatchIQ API-key authentication middleware.
 *
 * Cryptographic and persistence dependencies are mocked so these tests verify
 * header handling, credential validation, hash lookup, revocation protection,
 * concurrent revocation handling, usage tracking, safe request context, and
 * asynchronous error forwarding without requiring PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hashApiKeyMock = vi.fn();
const isApiKeyFormatValidMock = vi.fn();

const findApiKeyByHashMock = vi.fn();
const touchApiKeyLastUsedMock = vi.fn();

vi.mock('../api-keys/api-key.crypto.js', () => ({
  hashApiKey: hashApiKeyMock,
  isApiKeyFormatValid: isApiKeyFormatValidMock,
}));

vi.mock('../api-keys/api-key.repository.js', () => ({
  findApiKeyByHash: findApiKeyByHashMock,
  touchApiKeyLastUsed: touchApiKeyLastUsedMock,
}));

const { authenticateApiKey } = await import('./authenticate-api-key.js');

/**
 * Creates a minimal Express-style request object.
 *
 * @param {string | undefined} apiKey X-API-Key header value.
 * @returns {object} Request mock.
 */
function createRequest(apiKey) {
  return {
    get: vi.fn((headerName) => {
      if (headerName.toLowerCase() === 'x-api-key') {
        return apiKey;
      }

      return undefined;
    }),
  };
}

describe('API key authentication middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates a valid active API key', async () => {
    const rawApiKey = 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

    const user = {
      id: 'user-123',
      email: 'user@dispatchiq.dev',
      role: 'USER',
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
      updatedAt: new Date('2026-08-07T09:00:00.000Z'),
    };

    const apiKey = {
      id: 'key-123',
      userId: 'user-123',
      keyHash: 'hashed-api-key',
      name: 'Production integration',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      user,
    };

    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');
    findApiKeyByHashMock.mockResolvedValue(apiKey);

    touchApiKeyLastUsedMock.mockResolvedValue({
      count: 1,
    });

    const req = createRequest(rawApiKey);
    const res = {};
    const next = vi.fn();

    await authenticateApiKey(req, res, next);

    expect(isApiKeyFormatValidMock).toHaveBeenCalledWith(rawApiKey);

    expect(hashApiKeyMock).toHaveBeenCalledWith(rawApiKey);

    expect(findApiKeyByHashMock).toHaveBeenCalledWith('hashed-api-key');

    expect(touchApiKeyLastUsedMock).toHaveBeenCalledOnce();

    expect(req.user).toEqual(user);

    expect(req.apiKey).toMatchObject({
      id: 'key-123',
      name: 'Production integration',
      createdAt: apiKey.createdAt,
    });

    expect(req.apiKey.lastUsedAt).toBeInstanceOf(Date);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('does not expose raw credentials or hashes through request context', async () => {
    const rawApiKey = 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    findApiKeyByHashMock.mockResolvedValue({
      id: 'key-123',
      keyHash: 'hashed-api-key',
      name: 'CLI',
      revokedAt: null,
      createdAt: new Date(),
      user: {
        id: 'user-123',
        email: 'user@dispatchiq.dev',
        role: 'USER',
      },
    });

    touchApiKeyLastUsedMock.mockResolvedValue({
      count: 1,
    });

    const req = createRequest(rawApiKey);
    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(req.apiKey).not.toHaveProperty('keyHash');

    expect(req.apiKey).not.toHaveProperty('key');

    expect(req.apiKey).not.toHaveProperty('rawApiKey');
  });

  it('rejects a missing X-API-Key header', async () => {
    const req = createRequest(undefined);
    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next).toHaveBeenCalledOnce();

    expect(next.mock.calls[0][0]).toMatchObject({
      message: 'API key authentication is required.',
      statusCode: 401,
      code: 'API_KEY_REQUIRED',
    });

    expect(isApiKeyFormatValidMock).not.toHaveBeenCalled();

    expect(hashApiKeyMock).not.toHaveBeenCalled();
    expect(findApiKeyByHashMock).not.toHaveBeenCalled();
  });

  it('rejects an empty X-API-Key header', async () => {
    const req = createRequest('');
    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'API_KEY_REQUIRED',
    });
  });

  it('rejects a structurally invalid API key before hashing', async () => {
    isApiKeyFormatValidMock.mockReturnValue(false);

    const req = createRequest('invalid-key');
    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(isApiKeyFormatValidMock).toHaveBeenCalledWith('invalid-key');

    expect(hashApiKeyMock).not.toHaveBeenCalled();
    expect(findApiKeyByHashMock).not.toHaveBeenCalled();

    expect(next.mock.calls[0][0]).toMatchObject({
      message: 'API key is invalid.',
      statusCode: 401,
      code: 'INVALID_API_KEY',
    });
  });

  it('rejects an unknown API key', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('unknown-hash');
    findApiKeyByHashMock.mockResolvedValue(null);

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      message: 'API key is invalid.',
      statusCode: 401,
      code: 'INVALID_API_KEY',
    });

    expect(touchApiKeyLastUsedMock).not.toHaveBeenCalled();
  });

  it('rejects a revoked API key', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    findApiKeyByHashMock.mockResolvedValue({
      id: 'key-123',
      keyHash: 'hashed-api-key',
      name: 'Deprecated integration',
      revokedAt: new Date('2026-08-07T09:00:00.000Z'),
      createdAt: new Date(),
      user: {
        id: 'user-123',
      },
    });

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'INVALID_API_KEY',
    });

    expect(touchApiKeyLastUsedMock).not.toHaveBeenCalled();
  });

  it('rejects a key revoked concurrently after lookup', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    findApiKeyByHashMock.mockResolvedValue({
      id: 'key-123',
      keyHash: 'hashed-api-key',
      name: 'Production integration',
      revokedAt: null,
      createdAt: new Date(),
      user: {
        id: 'user-123',
        role: 'USER',
      },
    });

    touchApiKeyLastUsedMock.mockResolvedValue({
      count: 0,
    });

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'INVALID_API_KEY',
    });

    expect(req.user).toBeUndefined();
    expect(req.apiKey).toBeUndefined();
  });

  it('updates lastUsedAt before exposing authenticated context', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    findApiKeyByHashMock.mockResolvedValue({
      id: 'key-123',
      keyHash: 'hashed-api-key',
      name: 'CLI',
      revokedAt: null,
      createdAt: new Date(),
      user: {
        id: 'user-123',
        role: 'USER',
      },
    });

    touchApiKeyLastUsedMock.mockResolvedValue({
      count: 1,
    });

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    const usageInput = touchApiKeyLastUsedMock.mock.calls[0][0];

    expect(usageInput).toEqual({
      apiKeyId: 'key-123',
      usedAt: expect.any(Date),
    });

    expect(req.apiKey.lastUsedAt).toBe(usageInput.usedAt);
  });

  it('propagates API-key lookup failures to error middleware', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    const error = new Error('Database unavailable.');

    findApiKeyByHashMock.mockRejectedValue(error);

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next).toHaveBeenCalledWith(error);

    expect(touchApiKeyLastUsedMock).not.toHaveBeenCalled();
  });

  it('propagates last-used persistence failures', async () => {
    isApiKeyFormatValidMock.mockReturnValue(true);
    hashApiKeyMock.mockReturnValue('hashed-api-key');

    findApiKeyByHashMock.mockResolvedValue({
      id: 'key-123',
      keyHash: 'hashed-api-key',
      name: 'CLI',
      revokedAt: null,
      createdAt: new Date(),
      user: {
        id: 'user-123',
      },
    });

    const error = new Error('Database unavailable.');

    touchApiKeyLastUsedMock.mockRejectedValue(error);

    const req = createRequest('diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789');

    const next = vi.fn();

    await authenticateApiKey(req, {}, next);

    expect(next).toHaveBeenCalledWith(error);

    expect(req.user).toBeUndefined();
    expect(req.apiKey).toBeUndefined();
  });
});
