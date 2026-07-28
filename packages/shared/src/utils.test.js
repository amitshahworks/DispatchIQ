import { describe, expect, it } from 'vitest';

import { clamp, sleep } from './utils.js';

describe('shared utilities', () => {
  describe('clamp', () => {
    it('returns a value inside the range unchanged', () => {
      expect(clamp(5, 1, 10)).toBe(5);
    });

    it('returns the minimum when the value is too small', () => {
      expect(clamp(-1, 1, 10)).toBe(1);
    });

    it('returns the maximum when the value is too large', () => {
      expect(clamp(15, 1, 10)).toBe(10);
    });

    it('rejects an invalid range', () => {
      expect(() => clamp(5, 10, 1)).toThrow(RangeError);
    });
  });

  describe('sleep', () => {
    it('returns a promise', () => {
      expect(sleep(0)).toBeInstanceOf(Promise);
    });

    it('rejects negative durations', () => {
      expect(() => sleep(-1)).toThrow(TypeError);
    });
  });
});
