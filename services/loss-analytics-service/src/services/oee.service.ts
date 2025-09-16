import { OEERepository } from '../repositories/oee.repository';
import { createLogger } from '@ms5/shared/logger';
import { KafkaProducer } from '../events/producer';

const logger = createLogger('oee-service');

export interface OEECalculation {
  assetId: string;
  lineId: string;
  timestamp: Date;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  plannedProductionTime: number;
  runtime: number;
  downtime: number;
  idealCycleTime: number;
  totalCount: number;
  goodCount: number;
  rejectCount: number;
}

export class OEEService {
  private repository: OEERepository;
  private producer: KafkaProducer;

  constructor() {
    this.repository = new OEERepository();
    this.producer = new KafkaProducer();
  }

  async calculateOEE(
    assetId: string,
    startTime: Date,
    endTime: Date
  ): Promise<OEECalculation> {
    const telemetry = await this.repository.getTelemetryData(assetId, startTime, endTime);

    if (!telemetry || telemetry.length === 0) {
      throw new Error(`No telemetry data found for asset ${assetId}`);
    }

    const plannedProductionTime = (endTime.getTime() - startTime.getTime()) / 60000; // minutes
    const runtime = telemetry.reduce((sum, t) => sum + (t.runtime || 0), 0);
    const downtime = telemetry.reduce((sum, t) => sum + (t.downtime || 0), 0);
    const totalCount = telemetry.reduce((sum, t) => sum + ((t.goodCount || 0) + (t.rejectCount || 0)), 0);
    const goodCount = telemetry.reduce((sum, t) => sum + (t.goodCount || 0), 0);
    const rejectCount = telemetry.reduce((sum, t) => sum + (t.rejectCount || 0), 0);

    // Availability = Runtime / Planned Production Time
    const availability = plannedProductionTime > 0
      ? (runtime / plannedProductionTime) * 100
      : 0;

    // Performance = (Total Count × Ideal Cycle Time) / Runtime
    const idealCycleTime = 1; // minutes per unit (should be configurable per asset)
    const performance = runtime > 0
      ? ((totalCount * idealCycleTime) / runtime) * 100
      : 0;

    // Quality = Good Count / Total Count
    const quality = totalCount > 0
      ? (goodCount / totalCount) * 100
      : 0;

    // OEE = Availability × Performance × Quality
    const oee = (availability * performance * quality) / 10000;

    const calculation: OEECalculation = {
      assetId,
      lineId: telemetry[0].lineId,
      timestamp: new Date(),
      availability: Math.min(100, Math.max(0, availability)),
      performance: Math.min(100, Math.max(0, performance)),
      quality: Math.min(100, Math.max(0, quality)),
      oee: Math.min(100, Math.max(0, oee)),
      plannedProductionTime,
      runtime,
      downtime,
      idealCycleTime,
      totalCount,
      goodCount,
      rejectCount,
    };

    await this.repository.saveOEECalculation(calculation);

    await this.producer.sendOEEEvent({
      eventType: 'OEE_CALCULATED',
      assetId,
      data: calculation,
      timestamp: new Date().toISOString(),
    });

    logger.info({ assetId, oee: calculation.oee }, 'OEE calculated');

    return calculation;
  }

  async getOEETrend(
    lineId: string,
    startTime: Date,
    endTime: Date,
    granularity: 'hour' | 'day' | 'week' = 'hour'
  ) {
    return this.repository.getOEETrend(lineId, startTime, endTime, granularity);
  }

  async getCurrentOEE(lineId: string) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const assets = await this.repository.getLineAssets(lineId);
    const oeeData = await Promise.all(
      assets.map(asset => this.calculateOEE(asset.id, startOfDay, now))
    );

    // Calculate weighted average OEE for the line
    const totalProduction = oeeData.reduce((sum, d) => sum + d.totalCount, 0);
    const weightedOEE = oeeData.reduce(
      (sum, d) => sum + (d.oee * d.totalCount),
      0
    ) / (totalProduction || 1);

    return {
      lineId,
      oee: Math.min(100, Math.max(0, weightedOEE)),
      availability: oeeData.reduce((sum, d) => sum + d.availability, 0) / oeeData.length,
      performance: oeeData.reduce((sum, d) => sum + d.performance, 0) / oeeData.length,
      quality: oeeData.reduce((sum, d) => sum + d.quality, 0) / oeeData.length,
      timestamp: new Date(),
      assets: oeeData,
    };
  }

  async getWorldClassOEEComparison(lineId: string) {
    const current = await this.getCurrentOEE(lineId);

    // World Class OEE benchmarks
    const worldClass = {
      oee: 85,
      availability: 90,
      performance: 95,
      quality: 99.9,
    };

    return {
      current,
      worldClass,
      gaps: {
        oee: worldClass.oee - current.oee,
        availability: worldClass.availability - current.availability,
        performance: worldClass.performance - current.performance,
        quality: worldClass.quality - current.quality,
      },
      recommendations: this.generateOEERecommendations(current, worldClass),
    };
  }

  private generateOEERecommendations(current: any, worldClass: any) {
    const recommendations = [];

    if (current.availability < worldClass.availability) {
      recommendations.push({
        area: 'Availability',
        gap: worldClass.availability - current.availability,
        priority: 'HIGH',
        actions: [
          'Reduce unplanned downtime through predictive maintenance',
          'Improve changeover times with SMED techniques',
          'Implement autonomous maintenance programs',
        ],
      });
    }

    if (current.performance < worldClass.performance) {
      recommendations.push({
        area: 'Performance',
        gap: worldClass.performance - current.performance,
        priority: 'MEDIUM',
        actions: [
          'Optimize cycle times through process improvement',
          'Reduce minor stops and speed losses',
          'Implement real-time performance monitoring',
        ],
      });
    }

    if (current.quality < worldClass.quality) {
      recommendations.push({
        area: 'Quality',
        gap: worldClass.quality - current.quality,
        priority: current.quality < 95 ? 'HIGH' : 'LOW',
        actions: [
          'Implement in-process quality controls',
          'Use SPC to reduce variation',
          'Conduct root cause analysis on defects',
        ],
      });
    }

    return recommendations;
  }
}