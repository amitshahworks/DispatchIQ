/**
 * @file report-generation.handler.test.js
 * @description Unit tests for the simulated report-generation handler.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createReportGenerationHandler,
  validateReportGenerationPayload,
} from './report-generation.handler.js';

describe('report-generation handler', () => {
  describe('validateReportGenerationPayload', () => {
    it('normalizes a report payload', () => {
      expect(
        validateReportGenerationPayload({
          report: '  monthly-jobs  ',
          format: 'json',
          filters: {
            status: 'COMPLETED',
          },
        }),
      ).toEqual({
        report: 'monthly-jobs',
        format: 'JSON',
        filters: {
          status: 'COMPLETED',
        },
      });
    });

    it('accepts reportType for seed-data compatibility', () => {
      expect(
        validateReportGenerationPayload({
          reportType: 'worker-performance',
        }),
      ).toEqual({
        report: 'worker-performance',
        format: 'PDF',
      });
    });

    it('uses PDF as the default output format', () => {
      expect(
        validateReportGenerationPayload({
          report: 'daily-summary',
        }),
      ).toEqual({
        report: 'daily-summary',
        format: 'PDF',
      });
    });

    it('rejects a non-object payload', () => {
      expect(() => validateReportGenerationPayload(null)).toThrow(
        'REPORT_GENERATION job payload must be an object.',
      );
    });

    it('rejects a missing report identifier', () => {
      expect(() => validateReportGenerationPayload({})).toThrow(
        'REPORT_GENERATION payload requires a non-empty "report" or "reportType".',
      );
    });

    it('rejects unsupported output formats', () => {
      expect(() =>
        validateReportGenerationPayload({
          report: 'daily-summary',
          format: 'XML',
        }),
      ).toThrow('REPORT_GENERATION format "XML" is not supported.');
    });
  });

  describe('createReportGenerationHandler', () => {
    it('simulates generation of a report artifact', async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);

      const handler = createReportGenerationHandler({
        delayMs: 100,
        sleepFn,
      });

      const result = await handler({
        id: 'job-123',
        payload: {
          report: 'monthly-jobs',
          format: 'CSV',
        },
      });

      expect(sleepFn).toHaveBeenCalledWith(100);

      expect(result).toEqual({
        jobId: 'job-123',
        type: 'REPORT_GENERATION',
        generator: 'SIMULATED',
        report: 'monthly-jobs',
        format: 'CSV',
        artifactCreated: true,
      });
    });

    it('rejects a missing job object', async () => {
      const handler = createReportGenerationHandler({
        sleepFn: vi.fn(),
      });

      await expect(handler(null)).rejects.toThrow(
        'REPORT_GENERATION handler requires a job object.',
      );
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid simulated delay %s', (delayMs) => {
      expect(() =>
        createReportGenerationHandler({
          delayMs,
        }),
      ).toThrow('REPORT_GENERATION handler delayMs must be a non-negative integer.');
    });

    it('rejects an invalid sleep dependency', () => {
      expect(() =>
        createReportGenerationHandler({
          sleepFn: {},
        }),
      ).toThrow('REPORT_GENERATION handler requires a sleep function.');
    });
  });
});
