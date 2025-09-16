import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OEEService } from '../oee.service';
import { timescale } from '../../lib/timescale';
import { redis } from '../../lib/redis';

vi.mock('../../lib/timescale');
vi.mock('../../lib/redis');

describe('OEEService', () => {
  let service: OEEService;

  beforeEach(() => {
    service = new OEEService();
    vi.clearAllMocks();
  });

  describe('calculateOEE', () => {
    it('should calculate OEE correctly', async () => {
      const mockData = {
        runtime: 420, // 7 hours in minutes
        planned_time: 480, // 8 hours
        total_count: 1000,
        good_count: 950,
        ideal_cycle_time: 0.4 // minutes per unit
      };

      (timescale.query as any).mockResolvedValue({ rows: [mockData] });
      (redis.setex as any).mockResolvedValue('OK');

      const result = await service.calculateOEE('asset-1', new Date(), new Date());

      // Availability = 420/480 = 87.5%
      // Performance = (1000 * 0.4) / 420 = 95.24%
      // Quality = 950/1000 = 95%
      // OEE = 87.5 * 95.24 * 95 / 10000 = 79.16%

      expect(result).toEqual(expect.objectContaining({
        assetId: 'asset-1',
        availability: 87.5,
        performance: expect.closeTo(95.24, 1),
        quality: 95,
        oee: expect.closeTo(79.16, 1)
      }));

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining('oee:asset-1'),
        3600,
        expect.any(String)
      );
    });

    it('should handle zero planned time', async () => {
      const mockData = {
        runtime: 0,
        planned_time: 0,
        total_count: 0,
        good_count: 0,
        ideal_cycle_time: 0.4
      };

      (timescale.query as any).mockResolvedValue({ rows: [mockData] });

      const result = await service.calculateOEE('asset-1', new Date(), new Date());

      expect(result.availability).toBe(0);
      expect(result.performance).toBe(0);
      expect(result.quality).toBe(0);
      expect(result.oee).toBe(0);
    });
  });

  describe('getLossPareto', () => {
    it('should calculate Pareto analysis for losses', async () => {
      const mockLosses = [
        { loss_type: 'breakdown', duration_minutes: 120, count: 3 },
        { loss_type: 'changeover', duration_minutes: 60, count: 2 },
        { loss_type: 'minor_stops', duration_minutes: 30, count: 15 },
        { loss_type: 'speed_loss', duration_minutes: 20, count: 1 }
      ];

      (timescale.query as any).mockResolvedValue({ rows: mockLosses });

      const result = await service.getLossPareto('line-1', new Date(), new Date());

      expect(result).toHaveLength(4);
      expect(result[0].lossType).toBe('breakdown');
      expect(result[0].percentage).toBeCloseTo(52.17, 1); // 120/230
      expect(result[0].cumulativePercentage).toBeCloseTo(52.17, 1);
      expect(result[3].cumulativePercentage).toBe(100);
    });
  });

  describe('detectAnomalies', () => {
    it('should detect anomalies using z-score', async () => {
      const mockMetrics = [
        { timestamp: new Date(), value: 85 },
        { timestamp: new Date(), value: 87 },
        { timestamp: new Date(), value: 86 },
        { timestamp: new Date(), value: 45 }, // Anomaly
        { timestamp: new Date(), value: 88 },
        { timestamp: new Date(), value: 84 }
      ];

      (timescale.query as any).mockResolvedValue({ rows: mockMetrics });

      const result = await service.detectAnomalies('asset-1', 'oee', 2);

      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0].value).toBe(45);
      expect(Math.abs(result.anomalies[0].zScore)).toBeGreaterThan(2);
    });

    it('should handle no anomalies case', async () => {
      const mockMetrics = [
        { timestamp: new Date(), value: 85 },
        { timestamp: new Date(), value: 87 },
        { timestamp: new Date(), value: 86 },
        { timestamp: new Date(), value: 88 },
        { timestamp: new Date(), value: 84 }
      ];

      (timescale.query as any).mockResolvedValue({ rows: mockMetrics });

      const result = await service.detectAnomalies('asset-1', 'oee', 3);

      expect(result.anomalies).toHaveLength(0);
    });
  });

  describe('getTrends', () => {
    it('should calculate trend analysis', async () => {
      const now = new Date();
      const mockCurrentPeriod = [
        { value: 85 },
        { value: 87 },
        { value: 88 }
      ];
      const mockPreviousPeriod = [
        { value: 82 },
        { value: 83 },
        { value: 84 }
      ];

      (timescale.query as any)
        .mockResolvedValueOnce({ rows: mockCurrentPeriod })
        .mockResolvedValueOnce({ rows: mockPreviousPeriod });

      const result = await service.getTrends('line-1', 'week');

      const currentAvg = (85 + 87 + 88) / 3; // 86.67
      const previousAvg = (82 + 83 + 84) / 3; // 83
      const expectedChange = ((currentAvg - previousAvg) / previousAvg) * 100;

      expect(result.currentAverage).toBeCloseTo(86.67, 1);
      expect(result.previousAverage).toBe(83);
      expect(result.percentageChange).toBeCloseTo(expectedChange, 1);
      expect(result.trend).toBe('improving');
    });
  });
});