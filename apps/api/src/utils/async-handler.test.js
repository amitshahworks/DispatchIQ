/**
 * Tests the asynchronous Express route-handler wrapper.
 */

import { describe, expect, it, vi } from 'vitest';

import { asyncHandler } from './async-handler.js';

describe('asyncHandler', () => {
  it('executes a successful asynchronous handler', async () => {
    const request = {};
    const response = {};
    const next = vi.fn();
    const handler = vi.fn().mockResolvedValue(undefined);

    const wrappedHandler = asyncHandler(handler);

    await wrappedHandler(request, response, next);

    expect(handler).toHaveBeenCalledWith(request, response, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a rejected promise to Express', async () => {
    const error = new Error('Asynchronous failure.');
    const next = vi.fn();

    const wrappedHandler = asyncHandler(async () => {
      throw error;
    });

    await wrappedHandler({}, {}, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
  });

  it('forwards a synchronous error to Express', async () => {
    const error = new Error('Synchronous failure.');
    const next = vi.fn();

    const wrappedHandler = asyncHandler(() => {
      throw error;
    });

    await wrappedHandler({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
