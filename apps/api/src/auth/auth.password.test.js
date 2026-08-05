/**
 * Tests password hashing and verification behavior.
 */

import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './auth.password.js';

describe('authentication password utilities', () => {
  const password = 'DispatchIQ123';

  it('creates a bcrypt hash instead of returning the original password', async () => {
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('verifies the correct password', async () => {
    const passwordHash = await hashPassword(password);

    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const passwordHash = await hashPassword(password);

    await expect(verifyPassword('IncorrectPassword123', passwordHash)).resolves.toBe(false);
  });
});
