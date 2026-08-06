/**
 * @file job-processor.test.js
 * @description Unit tests for DispatchIQ claimed-job execution and lifecycle
 * outcome handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeClaimedJobMock = vi.fn();
const releaseJobForRetryMock = vi.fn();
const moveJobToDeadLetterMock = vi.fn();

vi.mock('./worker.repository.js', () => ({
  completeClaimedJob: completeClaimedJobMock,
  releaseJobForRetry: releaseJobForRetryMock,
  moveJobToDeadLetter: moveJobToDeadLetterMock,
}));

const { calculateRetryDelayMs, createJobProcessor, normalizeExecutionError } =
  await import('./job-processor.js');

/**
 * Creates a valid claimed-job fixture.
 *
 * @param {Partial<{
 *   job: object,
 *   attempt: object
 * }>} overrides Claim overrides.
 * @returns {{ job: object, attempt: object }} Claim fixture.
 */
function createClaim(overrides = {}) {
  return {
    job: {
      id: 'job-123',
      type: 'EMAIL',
      payload: {
        to: 'amit@example.com',
      },
      attemptCount: 1,
      maxAttempts: 3,
      ...overrides.job,
    },
    attempt: {
      id: 'attempt-123',
      ...overrides.attempt,
    },
  };
}

/**
 * Creates a deterministic sequence-based clock.
 *
 * @param {Date[]} dates Dates returned in invocation order.
 * @returns {ReturnType<typeof vi.fn>} Clock function.
 */
function createClock(...dates) {
  return vi.fn(() => dates.shift());
}

describe('job processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    completeClaimedJobMock.mockResolvedValue({
      id: 'job-123',
      status: 'COMPLETED',
    });

    releaseJobForRetryMock.mockResolvedValue({
      id: 'job-123',
      status: 'RETRYING',
    });

    moveJobToDeadLetterMock.mockResolvedValue({
      id: 'job-123',
      status: 'DEAD_LETTER',
    });
  });

  describe('successful execution', () => {
    it('runs the matching handler and marks the job completed', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');

      const completedAt = new Date('2026-08-06T10:00:02.500Z');

      const emailHandler = vi.fn().mockResolvedValue(undefined);

      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: emailHandler,
        },
        now: createClock(startedAt, completedAt),
      });

      const claim = createClaim();

      await processClaim(claim);

      expect(emailHandler).toHaveBeenCalledOnce();
      expect(emailHandler).toHaveBeenCalledWith(claim.job);

      expect(completeClaimedJobMock).toHaveBeenCalledWith({
        jobId: claim.job.id,
        workerId: 'worker-123',
        attemptId: claim.attempt.id,
        completedAt,
        durationMs: 2_500,
      });

      expect(releaseJobForRetryMock).not.toHaveBeenCalled();
      expect(moveJobToDeadLetterMock).not.toHaveBeenCalled();
    });

    it('never persists a negative execution duration', async () => {
      const startedAt = new Date('2026-08-06T10:00:02.000Z');

      const completedAt = new Date('2026-08-06T10:00:01.000Z');

      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: vi.fn().mockResolvedValue(undefined),
        },
        now: createClock(startedAt, completedAt),
      });

      await processClaim(createClaim());

      expect(completeClaimedJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMs: 0,
        }),
      );
    });
  });

  describe('retryable failure', () => {
    it('schedules a retry when attempts remain', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');

      const failedAt = new Date('2026-08-06T10:00:03.000Z');

      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: vi.fn().mockRejectedValue(new Error('Temporary email failure.')),
        },
        retryBaseDelayMs: 2_000,
        retryMaxDelayMs: 60_000,
        now: createClock(startedAt, failedAt),
      });

      const claim = createClaim({
        job: {
          attemptCount: 2,
          maxAttempts: 3,
        },
      });

      await processClaim(claim);

      expect(releaseJobForRetryMock).toHaveBeenCalledWith({
        jobId: claim.job.id,
        workerId: 'worker-123',
        attemptId: claim.attempt.id,
        errorMessage: 'Temporary email failure.',
        retryAt: new Date('2026-08-06T10:00:07.000Z'),
        failedAt,
        durationMs: 3_000,
      });

      expect(completeClaimedJobMock).not.toHaveBeenCalled();
      expect(moveJobToDeadLetterMock).not.toHaveBeenCalled();
    });

    it('uses the configured maximum retry-delay cap', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');

      const failedAt = new Date('2026-08-06T10:00:01.000Z');

      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: vi.fn().mockRejectedValue('Failure'),
        },
        retryBaseDelayMs: 10_000,
        retryMaxDelayMs: 30_000,
        now: createClock(startedAt, failedAt),
      });

      await processClaim(
        createClaim({
          job: {
            attemptCount: 4,
            maxAttempts: 5,
          },
        }),
      );

      expect(releaseJobForRetryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAt: new Date('2026-08-06T10:00:31.000Z'),
        }),
      );
    });
  });

  describe('exhausted failure', () => {
    it('moves the job to dead letter when no attempts remain', async () => {
      const startedAt = new Date('2026-08-06T10:00:00.000Z');

      const failedAt = new Date('2026-08-06T10:00:04.000Z');

      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          WEBHOOK: vi.fn().mockRejectedValue(new Error('Webhook permanently failed.')),
        },
        now: createClock(startedAt, failedAt),
      });

      const claim = createClaim({
        job: {
          type: 'WEBHOOK',
          attemptCount: 3,
          maxAttempts: 3,
        },
      });

      await processClaim(claim);

      expect(moveJobToDeadLetterMock).toHaveBeenCalledWith({
        jobId: claim.job.id,
        workerId: 'worker-123',
        attemptId: claim.attempt.id,
        errorMessage: 'Webhook permanently failed.',
        failedAt,
        durationMs: 4_000,
      });

      expect(completeClaimedJobMock).not.toHaveBeenCalled();
      expect(releaseJobForRetryMock).not.toHaveBeenCalled();
    });
  });

  describe('claim and handler validation', () => {
    it('rejects a claim without a job', async () => {
      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {},
      });

      await expect(
        processClaim({
          attempt: {
            id: 'attempt-123',
          },
        }),
      ).rejects.toThrow('Job processor requires a claimed job and attempt.');
    });

    it('rejects a claim without an attempt', async () => {
      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {},
      });

      await expect(
        processClaim({
          job: {
            id: 'job-123',
          },
        }),
      ).rejects.toThrow('Job processor requires a claimed job and attempt.');
    });

    it('rejects an unregistered job type', async () => {
      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {},
      });

      await expect(
        processClaim(
          createClaim({
            job: {
              type: 'REPORT_GENERATION',
            },
          }),
        ),
      ).rejects.toThrow('No worker handler is registered for job type "REPORT_GENERATION".');

      expect(completeClaimedJobMock).not.toHaveBeenCalled();
      expect(releaseJobForRetryMock).not.toHaveBeenCalled();
      expect(moveJobToDeadLetterMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid attempt count', async () => {
      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: vi.fn(),
        },
      });

      await expect(
        processClaim(
          createClaim({
            job: {
              attemptCount: 0,
            },
          }),
        ),
      ).rejects.toThrow('Claimed job contains an invalid attemptCount.');
    });

    it('rejects an invalid maximum-attempt count', async () => {
      const processClaim = createJobProcessor({
        workerId: 'worker-123',
        handlers: {
          EMAIL: vi.fn(),
        },
      });

      await expect(
        processClaim(
          createClaim({
            job: {
              maxAttempts: 0,
            },
          }),
        ),
      ).rejects.toThrow('Claimed job contains an invalid maxAttempts.');
    });
  });

  describe('processor configuration', () => {
    it('rejects an empty worker identifier', () => {
      expect(() =>
        createJobProcessor({
          workerId: '   ',
          handlers: {},
        }),
      ).toThrow('Job processor requires a valid workerId.');
    });

    it('rejects a missing handlers object', () => {
      expect(() =>
        createJobProcessor({
          workerId: 'worker-123',
        }),
      ).toThrow('Job processor requires a handlers object.');
    });

    it('rejects an array as the handlers configuration', () => {
      expect(() =>
        createJobProcessor({
          workerId: 'worker-123',
          handlers: [],
        }),
      ).toThrow('Job processor requires a handlers object.');
    });
  });
});

describe('retry delay calculation', () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
  ])('calculates exponential delay for attempt %s', (attemptCount, expectedDelay) => {
    expect(
      calculateRetryDelayMs({
        attemptCount,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
      }),
    ).toBe(expectedDelay);
  });

  it('caps exponential delay at the configured maximum', () => {
    expect(
      calculateRetryDelayMs({
        attemptCount: 10,
        baseDelayMs: 1_000,
        maxDelayMs: 30_000,
      }),
    ).toBe(30_000);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid attempt count %s', (attemptCount) => {
    expect(() =>
      calculateRetryDelayMs({
        attemptCount,
      }),
    ).toThrow('Retry calculation requires a positive attemptCount.');
  });

  it('rejects an invalid base delay', () => {
    expect(() =>
      calculateRetryDelayMs({
        attemptCount: 1,
        baseDelayMs: 0,
      }),
    ).toThrow('Retry baseDelayMs must be a positive integer.');
  });

  it('rejects an invalid maximum delay', () => {
    expect(() =>
      calculateRetryDelayMs({
        attemptCount: 1,
        maxDelayMs: 0,
      }),
    ).toThrow('Retry maxDelayMs must be a positive integer.');
  });

  it('rejects a maximum delay below the base delay', () => {
    expect(() =>
      calculateRetryDelayMs({
        attemptCount: 1,
        baseDelayMs: 10_000,
        maxDelayMs: 5_000,
      }),
    ).toThrow('Retry maxDelayMs cannot be lower than baseDelayMs.');
  });
});

describe('execution error normalization', () => {
  it('returns the message from an Error instance', () => {
    expect(normalizeExecutionError(new Error('Execution failed.'))).toBe('Execution failed.');
  });

  it('accepts a thrown string', () => {
    expect(normalizeExecutionError('String failure.')).toBe('String failure.');
  });

  it('returns a fallback for unknown thrown values', () => {
    expect(normalizeExecutionError({ reason: 'failure' })).toBe(
      'Job execution failed with an unknown error.',
    );
  });

  it('returns a fallback for an empty message', () => {
    expect(normalizeExecutionError(new Error('   '))).toBe(
      'Job execution failed with an unknown error.',
    );
  });

  it('limits persisted error messages to two thousand characters', () => {
    const result = normalizeExecutionError(new Error('x'.repeat(3_000)));

    expect(result).toHaveLength(2_000);
  });
});
