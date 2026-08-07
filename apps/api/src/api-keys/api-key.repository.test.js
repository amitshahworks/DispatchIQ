/**
 * @file api-key.repository.test.js
 * @description Unit tests for DispatchIQ API-key Prisma operations.
 *
 * Prisma is mocked so these tests verify persistence query construction,
 * credential secrecy, user ownership enforcement, revocation behavior, and
 * last-used tracking without requiring PostgreSQL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiKeyCreateMock = vi.fn();
const apiKeyFindManyMock = vi.fn();
const apiKeyFindUniqueMock = vi.fn();
const apiKeyFindFirstMock = vi.fn();
const apiKeyUpdateManyMock = vi.fn();

vi.mock('@dispatchiq/database', () => ({
  prisma: {
    apiKey: {
      create: apiKeyCreateMock,
      findMany: apiKeyFindManyMock,
      findUnique: apiKeyFindUniqueMock,
      findFirst: apiKeyFindFirstMock,
      updateMany: apiKeyUpdateManyMock,
    },
  },
}));

const {
  createApiKey,
  findApiKeyByHash,
  findApiKeyByIdForUser,
  findApiKeysForUser,
  revokeApiKey,
  touchApiKeyLastUsed,
} = await import('./api-key.repository.js');

describe('API key repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createApiKey', () => {
    it('persists the API-key hash and returns only safe metadata', async () => {
      const createdApiKey = {
        id: 'key-123',
        userId: 'user-123',
        name: 'CI deployment',
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-08-07T10:00:00.000Z'),
      };

      apiKeyCreateMock.mockResolvedValue(createdApiKey);

      const result = await createApiKey({
        userId: 'user-123',
        name: 'CI deployment',
        keyHash: 'hashed-api-key',
      });

      expect(apiKeyCreateMock).toHaveBeenCalledWith({
        data: {
          userId: 'user-123',
          name: 'CI deployment',
          keyHash: 'hashed-api-key',
        },
        select: {
          id: true,
          userId: true,
          name: true,
          lastUsedAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });

      expect(result).toEqual(createdApiKey);
      expect(result).not.toHaveProperty('keyHash');
    });
  });

  describe('findApiKeysForUser', () => {
    it('returns only user-owned API keys ordered newest first', async () => {
      apiKeyFindManyMock.mockResolvedValue([]);

      await findApiKeysForUser('user-123');

      expect(apiKeyFindManyMock).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          userId: true,
          name: true,
          lastUsedAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });
    });

    it('does not request stored key hashes for management listings', async () => {
      apiKeyFindManyMock.mockResolvedValue([]);

      await findApiKeysForUser('user-123');

      const query = apiKeyFindManyMock.mock.calls[0][0];

      expect(query.select).not.toHaveProperty('keyHash');
    });
  });

  describe('findApiKeyByHash', () => {
    it('looks up an API key by its unique hash and includes the owning user', async () => {
      apiKeyFindUniqueMock.mockResolvedValue({
        id: 'key-123',
      });

      await findApiKeyByHash('hashed-api-key');

      expect(apiKeyFindUniqueMock).toHaveBeenCalledWith({
        where: {
          keyHash: 'hashed-api-key',
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });
    });

    it('returns null when no stored hash matches', async () => {
      apiKeyFindUniqueMock.mockResolvedValue(null);

      await expect(findApiKeyByHash('unknown-hash')).resolves.toBeNull();
    });
  });

  describe('findApiKeyByIdForUser', () => {
    it('enforces ownership when retrieving API-key metadata', async () => {
      apiKeyFindFirstMock.mockResolvedValue({
        id: 'key-123',
        userId: 'user-123',
      });

      await findApiKeyByIdForUser({
        apiKeyId: 'key-123',
        userId: 'user-123',
      });

      expect(apiKeyFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'key-123',
          userId: 'user-123',
        },
        select: {
          id: true,
          userId: true,
          name: true,
          lastUsedAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });
    });
  });

  describe('revokeApiKey', () => {
    it('revokes only an active API key owned by the requesting user', async () => {
      const revokedAt = new Date('2026-08-07T10:00:00.000Z');

      apiKeyUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await revokeApiKey({
        apiKeyId: 'key-123',
        userId: 'user-123',
        revokedAt,
      });

      expect(apiKeyUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'key-123',
          userId: 'user-123',
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });

    it('returns zero when no active user-owned key can be revoked', async () => {
      apiKeyUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        revokeApiKey({
          apiKeyId: 'key-123',
          userId: 'user-123',
        }),
      ).resolves.toEqual({
        count: 0,
      });
    });

    it('uses the current time when revokedAt is omitted', async () => {
      apiKeyUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await revokeApiKey({
        apiKeyId: 'key-123',
        userId: 'user-123',
      });

      const query = apiKeyUpdateManyMock.mock.calls[0][0];

      expect(query.data.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('touchApiKeyLastUsed', () => {
    it('updates lastUsedAt only for an active API key', async () => {
      const usedAt = new Date('2026-08-07T10:15:00.000Z');

      apiKeyUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      const result = await touchApiKeyLastUsed({
        apiKeyId: 'key-123',
        usedAt,
      });

      expect(apiKeyUpdateManyMock).toHaveBeenCalledWith({
        where: {
          id: 'key-123',
          revokedAt: null,
        },
        data: {
          lastUsedAt: usedAt,
        },
      });

      expect(result).toEqual({
        count: 1,
      });
    });

    it('uses the current time when usedAt is omitted', async () => {
      apiKeyUpdateManyMock.mockResolvedValue({
        count: 1,
      });

      await touchApiKeyLastUsed({
        apiKeyId: 'key-123',
      });

      const query = apiKeyUpdateManyMock.mock.calls[0][0];

      expect(query.data.lastUsedAt).toBeInstanceOf(Date);
    });

    it('returns zero when the key has been revoked or no longer exists', async () => {
      apiKeyUpdateManyMock.mockResolvedValue({
        count: 0,
      });

      await expect(
        touchApiKeyLastUsed({
          apiKeyId: 'key-123',
        }),
      ).resolves.toEqual({
        count: 0,
      });
    });
  });
});
