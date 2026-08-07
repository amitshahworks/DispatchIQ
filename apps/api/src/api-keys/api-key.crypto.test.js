/**
 * @file api-key.crypto.test.js
 * @description Unit tests for DispatchIQ API-key cryptographic utilities.
 *
 * These tests verify credential format, entropy behavior, deterministic
 * hashing, input validation, and structural API-key validation without
 * persisting credentials or requiring database access.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateApiKey, hashApiKey, isApiKeyFormatValid } from './api-key.crypto.js';

describe('API key cryptography', () => {
  describe('generateApiKey', () => {
    it('generates a DispatchIQ-prefixed API key', () => {
      const apiKey = generateApiKey();

      expect(apiKey).toMatch(/^diq_live_[A-Za-z0-9_-]{43}$/);
    });

    it('generates credentials with 256 bits of random secret material', () => {
      const apiKey = generateApiKey();

      /*
       * Thirty-two random bytes encoded as unpadded base64url produce exactly
       * 43 characters after the credential prefix.
       */
      const secret = apiKey.slice('diq_live_'.length);

      expect(secret).toHaveLength(43);
    });

    it('generates different credentials across successive calls', () => {
      const firstApiKey = generateApiKey();
      const secondApiKey = generateApiKey();

      expect(firstApiKey).not.toBe(secondApiKey);
    });

    it('generates credentials accepted by the format validator', () => {
      const apiKey = generateApiKey();

      expect(isApiKeyFormatValid(apiKey)).toBe(true);
    });
  });

  describe('hashApiKey', () => {
    it('creates a deterministic SHA-256 hash', () => {
      const apiKey = 'diq_live_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789';

      const expectedHash = createHash('sha256').update(apiKey, 'utf8').digest('hex');

      expect(hashApiKey(apiKey)).toBe(expectedHash);
      expect(hashApiKey(apiKey)).toBe(expectedHash);
    });

    it('returns a lowercase 64-character hexadecimal digest', () => {
      const hash = hashApiKey(generateApiKey());

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes for different API keys', () => {
      const firstApiKey = generateApiKey();
      const secondApiKey = generateApiKey();

      expect(hashApiKey(firstApiKey)).not.toBe(hashApiKey(secondApiKey));
    });

    it('does not return the original API key', () => {
      const apiKey = generateApiKey();

      const hash = hashApiKey(apiKey);

      expect(hash).not.toBe(apiKey);
      expect(hash).not.toContain(apiKey);
    });

    it('preserves credential bytes rather than silently trimming input', () => {
      const apiKey = generateApiKey();

      expect(hashApiKey(` ${apiKey}`)).not.toBe(hashApiKey(apiKey));

      expect(hashApiKey(`${apiKey} `)).not.toBe(hashApiKey(apiKey));
    });

    it.each([undefined, null, '', 123, {}, []])('rejects invalid API-key input %#', (apiKey) => {
      expect(() => hashApiKey(apiKey)).toThrow('API key must be a non-empty string.');
    });
  });

  describe('isApiKeyFormatValid', () => {
    it('accepts a correctly formatted API key', () => {
      expect(isApiKeyFormatValid(generateApiKey())).toBe(true);
    });

    it('rejects a credential with an unsupported prefix', () => {
      const apiKey = generateApiKey().replace('diq_live_', 'other_');

      expect(isApiKeyFormatValid(apiKey)).toBe(false);
    });

    it('rejects a credential with a shortened secret', () => {
      expect(isApiKeyFormatValid('diq_live_abc123')).toBe(false);
    });

    it('rejects a credential with additional characters', () => {
      expect(isApiKeyFormatValid(`${generateApiKey()}extra`)).toBe(false);
    });

    it('rejects surrounding whitespace', () => {
      const apiKey = generateApiKey();

      expect(isApiKeyFormatValid(` ${apiKey}`)).toBe(false);

      expect(isApiKeyFormatValid(`${apiKey} `)).toBe(false);
    });

    it('rejects invalid base64url characters', () => {
      expect(isApiKeyFormatValid(`diq_live_${'a'.repeat(42)}!`)).toBe(false);
    });

    it.each([undefined, null, 123, {}, [], ''])('rejects non-credential value %#', (value) => {
      expect(isApiKeyFormatValid(value)).toBe(false);
    });
  });
});
