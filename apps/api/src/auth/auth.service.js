/**
 * @file auth.service.js
 * @description Authentication business logic for DispatchIQ.
 *
 * This service coordinates repository access, password hashing, access-token
 * creation, opaque refresh-token creation, and refresh-token persistence.
 *
 * HTTP request and response handling belongs to controllers. Direct Prisma
 * access belongs to the repository.
 */

import { HTTP_STATUS } from '@dispatchiq/shared';

import { AppError } from '../utils/app-error.js';
import { hashPassword, verifyPassword } from './auth.password.js';
import {
  calculateRefreshTokenExpiry,
  generateRefreshToken,
  hashRefreshToken,
} from './auth.refresh-token.js';
import {
  createUser,
  findRefreshToken,
  findUserByEmail,
  revokeRefreshToken,
  rotateRefreshToken,
  storeRefreshToken,
} from './auth.repository.js';
import { generateAccessToken } from './auth.tokens.js';

/**
 * Registers a new standard DispatchIQ user and creates an initial session.
 *
 * Registration never accepts or trusts a client-supplied role. The repository
 * always creates a standard USER account.
 *
 * @param {{ email: string, password: string }} input Validated registration
 * input.
 * @returns {Promise<{
 *   user: {
 *     id: string,
 *     email: string,
 *     role: string,
 *     createdAt: Date,
 *     updatedAt: Date
 *   },
 *   accessToken: string,
 *   refreshToken: string
 * }>} Safe user data and newly issued token pair.
 * @throws {AppError} When the email address is already registered.
 */
export async function register(input) {
  const existingUser = await findUserByEmail(input.email);

  if (existingUser) {
    throw new AppError('An account with this email address already exists.', HTTP_STATUS.CONFLICT, {
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  }

  const passwordHash = await hashPassword(input.password);

  const user = await createUser({
    email: input.email,
    passwordHash,
  });

  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role,
  });

  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = calculateRefreshTokenExpiry();

  await storeRefreshToken({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  return {
    user,
    accessToken,
    refreshToken,
  };
}

/**
 * Authenticates an existing user and creates a new session.
 *
 * Login failures intentionally return one generic error so clients cannot
 * determine whether an email address is registered.
 *
 * @param {{ email: string, password: string }} input Validated login input.
 * @returns {Promise<{
 *   user: {
 *     id: string,
 *     email: string,
 *     role: string,
 *     createdAt: Date,
 *     updatedAt: Date
 *   },
 *   accessToken: string,
 *   refreshToken: string
 * }>} Safe user data and newly issued token pair.
 * @throws {AppError} When the supplied credentials are invalid.
 */
export async function login(input) {
  const user = await findUserByEmail(input.email);

  const passwordMatches = user ? await verifyPassword(input.password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    throw new AppError('Invalid email or password.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_CREDENTIALS',
    });
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role,
  });

  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = calculateRefreshTokenExpiry();

  await storeRefreshToken({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    accessToken,
    refreshToken,
  };
}

/**
 * Revokes the supplied refresh token.
 *
 * Logout is intentionally idempotent. Unknown or already-revoked tokens are
 * treated as successfully logged out so the API does not reveal token state.
 *
 * @param {{ refreshToken: string }} input Validated logout input.
 * @returns {Promise<void>}
 */
export async function logout(input) {
  const tokenHash = hashRefreshToken(input.refreshToken);

  await revokeRefreshToken(tokenHash);
}

/**
 * Rotates a valid refresh token and issues a new authentication session.
 *
 * The old token is revoked and its replacement is stored atomically so a
 * partial database failure cannot leave the user without a valid session.
 *
 * @param {{ refreshToken: string }} input Validated refresh request.
 * @returns {Promise<{
 *   accessToken: string,
 *   refreshToken: string
 * }>} Newly issued access and refresh tokens.
 * @throws {AppError} When the refresh token is unknown, revoked, or expired.
 */
export async function refresh(input) {
  const currentTokenHash = hashRefreshToken(input.refreshToken);
  const storedToken = await findRefreshToken(currentTokenHash);

  const isExpired = storedToken && storedToken.expiresAt.getTime() <= Date.now();

  if (!storedToken || storedToken.revokedAt || isExpired) {
    throw new AppError('Refresh token is invalid or expired.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_REFRESH_TOKEN',
    });
  }

  const replacementRefreshToken = generateRefreshToken();
  const replacementTokenHash = hashRefreshToken(replacementRefreshToken);
  const replacementExpiresAt = calculateRefreshTokenExpiry();

  try {
    await rotateRefreshToken({
      currentTokenId: storedToken.id,
      userId: storedToken.userId,
      replacementTokenHash,
      replacementExpiresAt,
    });
  } catch {
    throw new AppError('Refresh token is invalid or expired.', HTTP_STATUS.UNAUTHORIZED, {
      code: 'INVALID_REFRESH_TOKEN',
    });
  }

  const accessToken = generateAccessToken({
    userId: storedToken.user.id,
    role: storedToken.user.role,
  });

  return {
    accessToken,
    refreshToken: replacementRefreshToken,
  };
}
