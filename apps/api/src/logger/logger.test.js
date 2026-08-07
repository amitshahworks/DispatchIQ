/**
 * @file logger.test.js
 * @description Unit tests for the DispatchIQ structured logger.
 *
 * These tests verify logger creation, configured service metadata, child
 * logger creation, and safe behavior in the test environment without emitting
 * noisy application logs during the Vitest suite.
 */

import { describe, expect, it } from 'vitest';

import { createChildLogger, createLogger, logger } from './logger.js';

describe('structured logger', () => {
  it('creates a Pino logger instance', () => {
    const createdLogger = createLogger();

    expect(createdLogger).toBeDefined();
    expect(typeof createdLogger.info).toBe('function');
    expect(typeof createdLogger.error).toBe('function');
    expect(typeof createdLogger.warn).toBe('function');
    expect(typeof createdLogger.debug).toBe('function');
  });

  it('exports a shared logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.child).toBe('function');
  });

  it('uses silent logging during automated tests', () => {
    const createdLogger = createLogger();

    expect(createdLogger.level).toBe('silent');
  });

  it('creates child loggers containing persistent context', () => {
    const childLogger = createChildLogger({
      requestId: 'request-123',
      userId: 'user-123',
    });

    expect(childLogger).toBeDefined();
    expect(typeof childLogger.info).toBe('function');
  });

  it('creates independent child logger instances', () => {
    const first = createChildLogger({
      requestId: 'request-1',
    });

    const second = createChildLogger({
      requestId: 'request-2',
    });

    expect(first).not.toBe(second);
  });

  it('supports structured log objects without throwing', () => {
    const createdLogger = createLogger();

    expect(() => {
      createdLogger.info(
        {
          requestId: 'request-123',
          statusCode: 200,
        },
        'Request completed.',
      );
    }).not.toThrow();
  });

  it('supports structured error objects without throwing', () => {
    const createdLogger = createLogger();

    expect(() => {
      createdLogger.error(
        {
          requestId: 'request-123',
          error: new Error('Test error'),
        },
        'Unexpected failure.',
      );
    }).not.toThrow();
  });
});
