/**
 * @file api-key.service.test.js
 * @description Unit tests for DispatchIQ API-key management business logic.
 *
 * Cryptographic utilities and repository operations are mocked so these tests
 * focus on one-time raw credential handling, hash persistence, safe listing,
 * ownership-aware revocation, race handling, and consistent application
 * errors without requiring PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateApiKeyMock = vi.fn();
const hashApiKeyMock = vi.fn();

const createApiKeyRecordMock = vi.fn();
const findApiKeysForUserMock = vi.fn();
const findApiKeyByIdForUserMock = vi.fn();
const revokeApiKeyRecordMock = vi.fn();

vi.mock('./api-key.crypto.js', () => ({
  generateApiKey: generateApiKeyMock,
  hashApiKey: hashApiKeyMock,
}));

vi.mock('./api-key.repository.js', () => ({
  createApiKey: createApiKeyRecordMock,
  findApiKeysForUser: findApiKeysForUserMock,
  findApiKeyByIdForUser: findApiKeyByIdForUserMock,
  revokeApiKey: revokeApiKeyRecordMock,
}));

const { createApiKey, listApiKeys, revokeApiKey } = await import('./api-key.service.js');

describe('API key service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApiKey', () => {
    it('generates, hashes, persists, and returns the raw credential once', async () => {
      const rawApiKey = 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';
      const keyHash = 'hashed-api-key';

      const createdRecord = {
        id: 'key-123',
        userId: 'user-123',
        name: 'CI deployment',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-08-07T10:00:00.000Z'),
      };

      generateApiKeyMock.mockReturnValue(rawApiKey);
      hashApiKeyMock.mockReturnValue(keyHash);
      createApiKeyRecordMock.mockResolvedValue(createdRecord);

      const result = await createApiKey('user-123', {
        name: 'CI deployment',
      });

      expect(generateApiKeyMock).toHaveBeenCalledOnce();

      expect(hashApiKeyMock).toHaveBeenCalledWith(rawApiKey);

      expect(createApiKeyRecordMock).toHaveBeenCalledWith({
        userId: 'user-123',
        name: 'CI deployment',
        keyHash,
      });

      expect(result).toEqual({
        apiKey: createdRecord,
        key: rawApiKey,
      });
    });

    it('does not persist the raw API key', async () => {
      const rawApiKey = 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

      generateApiKeyMock.mockReturnValue(rawApiKey);
      hashApiKeyMock.mockReturnValue('hashed-api-key');

      createApiKeyRecordMock.mockResolvedValue({
        id: 'key-123',
      });

      await createApiKey('user-123', {
        name: 'CLI',
      });

      const persistedInput = createApiKeyRecordMock.mock.calls[0][0];

      expect(persistedInput).not.toHaveProperty('key');
      expect(persistedInput).not.toHaveProperty('rawApiKey');

      expect(persistedInput.keyHash).toBe('hashed-api-key');
      expect(persistedInput.keyHash).not.toBe(rawApiKey);
    });

    it('propagates persistence failures without returning a credential', async () => {
      generateApiKeyMock.mockReturnValue('diq_live_secret');
      hashApiKeyMock.mockReturnValue('hashed-api-key');

      createApiKeyRecordMock.mockRejectedValue(new Error('Database unavailable.'));

      await expect(
        createApiKey('user-123', {
          name: 'CLI',
        }),
      ).rejects.toThrow('Database unavailable.');
    });

    it('does not attempt persistence when hashing fails', async () => {
      generateApiKeyMock.mockReturnValue('diq_live_secret');

      hashApiKeyMock.mockImplementation(() => {
        throw new Error('Hashing failed.');
      });

      await expect(
        createApiKey('user-123', {
          name: 'CLI',
        }),
      ).rejects.toThrow('Hashing failed.');

      expect(createApiKeyRecordMock).not.toHaveBeenCalled();
    });
  });

  describe('listApiKeys', () => {
    it('returns safe API-key metadata owned by the user', async () => {
      const apiKeys = [
        {
          id: 'key-2',
          userId: 'user-123',
          name: 'Production',
          lastUsedAt: new Date('2026-08-07T10:00:00.000Z'),
          revokedAt: null,
          createdAt: new Date('2026-08-07T09:00:00.000Z'),
        },
        {
          id: 'key-1',
          userId: 'user-123',
          name: 'Local CLI',
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-08-06T09:00:00.000Z'),
        },
      ];

      findApiKeysForUserMock.mockResolvedValue(apiKeys);

      const result = await listApiKeys('user-123');

      expect(findApiKeysForUserMock).toHaveBeenCalledWith('user-123');

      expect(result).toEqual(apiKeys);
    });

    it('returns an empty collection when the user has no API keys', async () => {
      findApiKeysForUserMock.mockResolvedValue([]);

      await expect(listApiKeys('user-123')).resolves.toEqual([]);
    });

    it('propagates repository failures', async () => {
      findApiKeysForUserMock.mockRejectedValue(new Error('Database unavailable.'));

      await expect(listApiKeys('user-123')).rejects.toThrow('Database unavailable.');
    });
  });

  describe('revokeApiKey', () => {
    const existingApiKey = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-123',
      name: 'Production',
      lastUsedAt: new Date('2026-08-07T09:30:00.000Z'),
      revokedAt: null,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
    };

    it('revokes an active API key owned by the user', async () => {
      const revokedAt = new Date('2026-08-07T10:00:00.000Z');

      findApiKeyByIdForUserMock.mockResolvedValue(existingApiKey);

      revokeApiKeyRecordMock.mockResolvedValue({
        count: 1,
      });

      const result = await revokeApiKey('user-123', existingApiKey.id, revokedAt);

      expect(findApiKeyByIdForUserMock).toHaveBeenCalledWith({
        apiKeyId: existingApiKey.id,
        userId: 'user-123',
      });

      expect(revokeApiKeyRecordMock).toHaveBeenCalledWith({
        apiKeyId: existingApiKey.id,
        userId: 'user-123',
        revokedAt,
      });

      expect(result).toEqual({
        ...existingApiKey,
        revokedAt,
      });
    });

    it('uses the current time when the revocation timestamp is omitted', async () => {
      findApiKeyByIdForUserMock.mockResolvedValue(existingApiKey);

      revokeApiKeyRecordMock.mockResolvedValue({
        count: 1,
      });

      const result = await revokeApiKey('user-123', existingApiKey.id);

      const repositoryInput = revokeApiKeyRecordMock.mock.calls[0][0];

      expect(repositoryInput.revokedAt).toBeInstanceOf(Date);
      expect(result.revokedAt).toBe(repositoryInput.revokedAt);
    });

    it('rejects an unknown or non-owned API key', async () => {
      findApiKeyByIdForUserMock.mockResolvedValue(null);

      await expect(
        revokeApiKey('user-123', '550e8400-e29b-41d4-a716-446655440000'),
      ).rejects.toMatchObject({
        message: 'API key was not found.',
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
      });

      expect(revokeApiKeyRecordMock).not.toHaveBeenCalled();
    });

    it('rejects an API key that is already revoked', async () => {
      findApiKeyByIdForUserMock.mockResolvedValue({
        ...existingApiKey,
        revokedAt: new Date('2026-08-07T09:00:00.000Z'),
      });

      await expect(revokeApiKey('user-123', existingApiKey.id)).rejects.toMatchObject({
        message: 'API key was not found.',
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
      });

      expect(revokeApiKeyRecordMock).not.toHaveBeenCalled();
    });

    it('handles concurrent revocation races as unavailable keys', async () => {
      findApiKeyByIdForUserMock.mockResolvedValue(existingApiKey);

      revokeApiKeyRecordMock.mockResolvedValue({
        count: 0,
      });

      await expect(revokeApiKey('user-123', existingApiKey.id)).rejects.toMatchObject({
        message: 'API key was not found.',
        statusCode: 404,
        code: 'API_KEY_NOT_FOUND',
      });
    });

    it('propagates lookup failures', async () => {
      findApiKeyByIdForUserMock.mockRejectedValue(new Error('Database unavailable.'));

      await expect(revokeApiKey('user-123', existingApiKey.id)).rejects.toThrow(
        'Database unavailable.',
      );

      expect(revokeApiKeyRecordMock).not.toHaveBeenCalled();
    });

    it('propagates revocation persistence failures', async () => {
      findApiKeyByIdForUserMock.mockResolvedValue(existingApiKey);

      revokeApiKeyRecordMock.mockRejectedValue(new Error('Database unavailable.'));

      await expect(revokeApiKey('user-123', existingApiKey.id)).rejects.toThrow(
        'Database unavailable.',
      );
    });
  });
});
