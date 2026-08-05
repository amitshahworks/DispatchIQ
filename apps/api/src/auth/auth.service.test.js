/**
 * @file auth.service.test.js
 * @description Unit tests for DispatchIQ authentication business logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUserByEmailMock = vi.fn();
const createUserMock = vi.fn();
const storeRefreshTokenMock = vi.fn();

const hashPasswordMock = vi.fn();
const verifyPasswordMock = vi.fn();

const generateAccessTokenMock = vi.fn();

const generateRefreshTokenMock = vi.fn();
const hashRefreshTokenMock = vi.fn();
const calculateRefreshTokenExpiryMock = vi.fn();
const revokeRefreshTokenMock = vi.fn();

vi.mock('./auth.repository.js', () => ({
  findUserByEmail: findUserByEmailMock,
  createUser: createUserMock,
  storeRefreshToken: storeRefreshTokenMock,
  revokeRefreshToken: revokeRefreshTokenMock,
}));

vi.mock('./auth.password.js', () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
}));

vi.mock('./auth.tokens.js', () => ({
  generateAccessToken: generateAccessTokenMock,
}));

vi.mock('./auth.refresh-token.js', () => ({
  generateRefreshToken: generateRefreshTokenMock,
  hashRefreshToken: hashRefreshTokenMock,
  calculateRefreshTokenExpiry: calculateRefreshTokenExpiryMock,
}));

const { login, logout, register } = await import('./auth.service.js');

describe('authentication service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('creates a user and initial authentication session', async () => {
      const input = {
        email: 'amit@example.com',
        password: 'SecurePassword123',
      };

      const user = {
        id: 'user-123',
        email: input.email,
        role: 'USER',
        createdAt: new Date('2026-08-05T12:00:00.000Z'),
        updatedAt: new Date('2026-08-05T12:00:00.000Z'),
      };

      const refreshTokenExpiry = new Date('2026-08-12T12:00:00.000Z');

      findUserByEmailMock.mockResolvedValue(null);
      hashPasswordMock.mockResolvedValue('hashed-password');
      createUserMock.mockResolvedValue(user);
      generateAccessTokenMock.mockReturnValue('access-token');
      generateRefreshTokenMock.mockReturnValue('refresh-token');
      hashRefreshTokenMock.mockReturnValue('refresh-token-hash');
      calculateRefreshTokenExpiryMock.mockReturnValue(refreshTokenExpiry);
      storeRefreshTokenMock.mockResolvedValue({
        id: 'refresh-token-record',
      });

      const result = await register(input);

      expect(findUserByEmailMock).toHaveBeenCalledWith(input.email);

      expect(hashPasswordMock).toHaveBeenCalledWith(input.password);

      expect(createUserMock).toHaveBeenCalledWith({
        email: input.email,
        passwordHash: 'hashed-password',
      });

      expect(generateAccessTokenMock).toHaveBeenCalledWith({
        userId: user.id,
        role: user.role,
      });

      expect(storeRefreshTokenMock).toHaveBeenCalledWith({
        userId: user.id,
        tokenHash: 'refresh-token-hash',
        expiresAt: refreshTokenExpiry,
      });

      expect(result).toEqual({
        user,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    it('rejects registration when the email already exists', async () => {
      findUserByEmailMock.mockResolvedValue({
        id: 'existing-user',
      });

      await expect(
        register({
          email: 'amit@example.com',
          password: 'SecurePassword123',
        }),
      ).rejects.toMatchObject({
        name: 'AppError',
        statusCode: 409,
        code: 'EMAIL_ALREADY_REGISTERED',
      });

      expect(hashPasswordMock).not.toHaveBeenCalled();
      expect(createUserMock).not.toHaveBeenCalled();
      expect(storeRefreshTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const input = {
      email: 'amit@example.com',
      password: 'SecurePassword123',
    };

    const storedUser = {
      id: 'user-123',
      email: input.email,
      passwordHash: 'stored-password-hash',
      role: 'USER',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      updatedAt: new Date('2026-08-05T12:00:00.000Z'),
    };

    it('authenticates a user and creates a new session', async () => {
      const refreshTokenExpiry = new Date('2026-08-12T12:00:00.000Z');

      findUserByEmailMock.mockResolvedValue(storedUser);
      verifyPasswordMock.mockResolvedValue(true);
      generateAccessTokenMock.mockReturnValue('access-token');
      generateRefreshTokenMock.mockReturnValue('refresh-token');
      hashRefreshTokenMock.mockReturnValue('refresh-token-hash');
      calculateRefreshTokenExpiryMock.mockReturnValue(refreshTokenExpiry);
      storeRefreshTokenMock.mockResolvedValue({
        id: 'refresh-token-record',
      });

      const result = await login(input);

      expect(findUserByEmailMock).toHaveBeenCalledWith(input.email);

      expect(verifyPasswordMock).toHaveBeenCalledWith(input.password, storedUser.passwordHash);

      expect(generateAccessTokenMock).toHaveBeenCalledWith({
        userId: storedUser.id,
        role: storedUser.role,
      });

      expect(storeRefreshTokenMock).toHaveBeenCalledWith({
        userId: storedUser.id,
        tokenHash: 'refresh-token-hash',
        expiresAt: refreshTokenExpiry,
      });

      expect(result).toEqual({
        user: {
          id: storedUser.id,
          email: storedUser.email,
          role: storedUser.role,
          createdAt: storedUser.createdAt,
          updatedAt: storedUser.updatedAt,
        },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('returns a generic error when the user does not exist', async () => {
      findUserByEmailMock.mockResolvedValue(null);

      await expect(login(input)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });

      expect(verifyPasswordMock).not.toHaveBeenCalled();
      expect(generateAccessTokenMock).not.toHaveBeenCalled();
      expect(storeRefreshTokenMock).not.toHaveBeenCalled();
    });

    it('returns the same generic error when the password is wrong', async () => {
      findUserByEmailMock.mockResolvedValue(storedUser);
      verifyPasswordMock.mockResolvedValue(false);

      await expect(login(input)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });

      expect(generateAccessTokenMock).not.toHaveBeenCalled();
      expect(storeRefreshTokenMock).not.toHaveBeenCalled();
    });
  });
});

describe('logout', () => {
  it('hashes and revokes the supplied refresh token', async () => {
    hashRefreshTokenMock.mockReturnValue('refresh-token-hash');
    revokeRefreshTokenMock.mockResolvedValue({
      count: 1,
    });

    await expect(
      logout({
        refreshToken: 'raw-refresh-token',
      }),
    ).resolves.toBeUndefined();

    expect(hashRefreshTokenMock).toHaveBeenCalledWith('raw-refresh-token');

    expect(revokeRefreshTokenMock).toHaveBeenCalledWith('refresh-token-hash');
  });

  it('remains successful when the token does not exist', async () => {
    hashRefreshTokenMock.mockReturnValue('unknown-token-hash');
    revokeRefreshTokenMock.mockResolvedValue({
      count: 0,
    });

    await expect(
      logout({
        refreshToken: 'unknown-refresh-token',
      }),
    ).resolves.toBeUndefined();
  });
});
