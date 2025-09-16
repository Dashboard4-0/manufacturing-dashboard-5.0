import { Counter, Gauge, Histogram, register, Registry } from 'prom-client';
import { createLogger } from '../logger';

const logger = createLogger('business-metrics');

// Create a custom registry for business metrics
export const businessRegistry = new Registry();

// ============================================================================
// Production Metrics
// ============================================================================

export const oeeGauge = new Gauge({
  name: 'ms5_oee_percentage',
  help: 'Current OEE percentage by line and shift',
  labelNames: ['line_id', 'line_name', 'shift', 'asset_id'],
  registers: [businessRegistry, register]
});

export const availabilityGauge = new Gauge({
  name: 'ms5_availability_percentage',
  help: 'Availability percentage (runtime / planned time)',
  labelNames: ['line_id', 'asset_id'],
  registers: [businessRegistry, register]
});

export const performanceGauge = new Gauge({
  name: 'ms5_performance_percentage',
  help: 'Performance percentage (actual rate / ideal rate)',
  labelNames: ['line_id', 'asset_id'],
  registers: [businessRegistry, register]
});

export const qualityGauge = new Gauge({
  name: 'ms5_quality_percentage',
  help: 'Quality percentage (good count / total count)',
  labelNames: ['line_id', 'asset_id', 'product_type'],
  registers: [businessRegistry, register]
});

export const productionCounter = new Counter({
  name: 'ms5_production_count_total',
  help: 'Total production count by line and quality status',
  labelNames: ['line_id', 'status', 'product_type', 'shift'],
  registers: [businessRegistry, register]
});

export const defectCounter = new Counter({
  name: 'ms5_defect_count_total',
  help: 'Total defect count by line and defect type',
  labelNames: ['line_id', 'defect_type', 'product_type', 'severity'],
  registers: [businessRegistry, register]
});

export const reworkCounter = new Counter({
  name: 'ms5_rework_count_total',
  help: 'Total rework count by line and reason',
  labelNames: ['line_id', 'reason', 'product_type'],
  registers: [businessRegistry, register]
});

// ============================================================================
// Andon System Metrics
// ============================================================================

export const andonCounter = new Counter({
  name: 'ms5_andon_triggers_total',
  help: 'Total Andon triggers by type and line',
  labelNames: ['type', 'line_id', 'station_id', 'severity', 'shift'],
  registers: [businessRegistry, register]
});

export const andonResponseTime = new Histogram({
  name: 'ms5_andon_response_time_seconds',
  help: 'Time to acknowledge Andon call',
  labelNames: ['type', 'line_id', 'responder_role'],
  buckets: [30, 60, 120, 300, 600, 1800], // 30s, 1m, 2m, 5m, 10m, 30m
  registers: [businessRegistry, register]
});

export const andonResolutionTime = new Histogram({
  name: 'ms5_andon_resolution_time_seconds',
  help: 'Time to resolve Andon call',
  labelNames: ['type', 'line_id', 'root_cause'],
  buckets: [60, 300, 600, 1800, 3600, 7200], // 1m, 5m, 10m, 30m, 1h, 2h
  registers: [businessRegistry, register]
});

export const activeAndonGauge = new Gauge({
  name: 'ms5_andon_active_calls',
  help: 'Currently active Andon calls',
  labelNames: ['type', 'line_id', 'escalation_level'],
  registers: [businessRegistry, register]
});

// ============================================================================
// SQDC/DMS Metrics
// ============================================================================

export const actionCounter = new Counter({
  name: 'ms5_sqdc_actions_total',
  help: 'Total SQDC actions created',
  labelNames: ['board_type', 'category', 'priority', 'line_id'],
  registers: [businessRegistry, register]
});

export const actionCompletionTime = new Histogram({
  name: 'ms5_action_completion_hours',
  help: 'Time to complete SQDC actions in hours',
  labelNames: ['board_type', 'category', 'priority'],
  buckets: [1, 4, 8, 24, 48, 72, 168, 336], // 1h, 4h, 8h, 1d, 2d, 3d, 1w, 2w
  registers: [businessRegistry, register]
});

export const openActionsGauge = new Gauge({
  name: 'ms5_sqdc_open_actions',
  help: 'Number of open SQDC actions',
  labelNames: ['board_type', 'category', 'status', 'overdue'],
  registers: [businessRegistry, register]
});

export const boardComplianceGauge = new Gauge({
  name: 'ms5_sqdc_board_compliance_percentage',
  help: 'SQDC board update compliance percentage',
  labelNames: ['line_id', 'board_type', 'shift'],
  registers: [businessRegistry, register]
});

// ============================================================================
// Loss Analytics Metrics
// ============================================================================

export const downtimeCounter = new Counter({
  name: 'ms5_downtime_minutes_total',
  help: 'Total downtime in minutes by reason',
  labelNames: ['line_id', 'asset_id', 'reason', 'category', 'shift'],
  registers: [businessRegistry, register]
});

export const downtimeHistogram = new Histogram({
  name: 'ms5_downtime_duration_minutes',
  help: 'Downtime event duration distribution',
  labelNames: ['reason', 'category'],
  buckets: [1, 5, 10, 15, 30, 60, 120, 240, 480], // up to 8 hours
  registers: [businessRegistry, register]
});

export const mtbfGauge = new Gauge({
  name: 'ms5_mtbf_hours',
  help: 'Mean Time Between Failures in hours',
  labelNames: ['asset_id', 'failure_type'],
  registers: [businessRegistry, register]
});

export const mttrGauge = new Gauge({
  name: 'ms5_mttr_minutes',
  help: 'Mean Time To Repair in minutes',
  labelNames: ['asset_id', 'failure_type'],
  registers: [businessRegistry, register]
});

export const speedLossGauge = new Gauge({
  name: 'ms5_speed_loss_percentage',
  help: 'Speed loss percentage vs ideal cycle time',
  labelNames: ['line_id', 'asset_id', 'product_type'],
  registers: [businessRegistry, register]
});

// ============================================================================
// Data Pipeline Metrics
// ============================================================================

export const dataIngestionRate = new Gauge({
  name: 'ms5_data_ingestion_rate',
  help: 'Data points ingested per second',
  labelNames: ['source', 'type', 'protocol'],
  registers: [businessRegistry, register]
});

export const dataIngestionCounter = new Counter({
  name: 'ms5_data_ingestion_total',
  help: 'Total data points ingested',
  labelNames: ['source', 'type', 'status'],
  registers: [businessRegistry, register]
});

export const dataLatency = new Histogram({
  name: 'ms5_data_latency_milliseconds',
  help: 'End-to-end data latency from edge to cloud',
  labelNames: ['source', 'destination'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [businessRegistry, register]
});

export const edgeSyncBacklog = new Gauge({
  name: 'ms5_edge_sync_backlog',
  help: 'Number of events pending sync from edge',
  labelNames: ['edge_site', 'priority'],
  registers: [businessRegistry, register]
});

// ============================================================================
// Business KPI Metrics
// ============================================================================

export const productivityGauge = new Gauge({
  name: 'ms5_productivity_units_per_hour',
  help: 'Production productivity in units per hour',
  labelNames: ['line_id', 'product_type', 'shift'],
  registers: [businessRegistry, register]
});

export const utilizationGauge = new Gauge({
  name: 'ms5_utilization_percentage',
  help: 'Equipment utilization percentage',
  labelNames: ['asset_id', 'asset_type'],
  registers: [businessRegistry, register]
});

export const yieldGauge = new Gauge({
  name: 'ms5_yield_percentage',
  help: 'First pass yield percentage',
  labelNames: ['line_id', 'product_type', 'shift'],
  registers: [businessRegistry, register]
});

export const costPerUnitGauge = new Gauge({
  name: 'ms5_cost_per_unit',
  help: 'Cost per unit produced',
  labelNames: ['line_id', 'product_type', 'cost_category'],
  registers: [businessRegistry, register]
});

export const energyConsumption = new Counter({
  name: 'ms5_energy_consumption_kwh',
  help: 'Energy consumption in kilowatt-hours',
  labelNames: ['line_id', 'asset_id', 'energy_type'],
  registers: [businessRegistry, register]
});

// ============================================================================
// User Activity Metrics
// ============================================================================

export const userActivityCounter = new Counter({
  name: 'ms5_user_activity_total',
  help: 'User activity events',
  labelNames: ['user_role', 'action', 'resource'],
  registers: [businessRegistry, register]
});

export const activeUsersGauge = new Gauge({
  name: 'ms5_active_users',
  help: 'Currently active users',
  labelNames: ['role', 'department'],
  registers: [businessRegistry, register]
});

// ============================================================================
// Alert and Notification Metrics
// ============================================================================

export const alertCounter = new Counter({
  name: 'ms5_alerts_total',
  help: 'Total alerts generated',
  labelNames: ['type', 'severity', 'source'],
  registers: [businessRegistry, register]
});

export const notificationCounter = new Counter({
  name: 'ms5_notifications_total',
  help: 'Total notifications sent',
  labelNames: ['channel', 'type', 'priority'],
  registers: [businessRegistry, register]
});

export const alertResponseTime = new Histogram({
  name: 'ms5_alert_response_time_seconds',
  help: 'Time to acknowledge alerts',
  labelNames: ['type', 'severity'],
  buckets: [60, 300, 600, 1800, 3600],
  registers: [businessRegistry, register]
});

// ============================================================================
// Helper Functions for Metric Updates
// ============================================================================

export function updateOEEMetrics(data: {
  lineId: string;
  lineName: string;
  assetId?: string;
  shift: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}): void {
  const labels = {
    line_id: data.lineId,
    line_name: data.lineName,
    shift: data.shift,
    asset_id: data.assetId || 'all'
  };

  oeeGauge.set(labels, data.oee);
  availabilityGauge.set({ line_id: data.lineId, asset_id: data.assetId || 'all' }, data.availability);
  performanceGauge.set({ line_id: data.lineId, asset_id: data.assetId || 'all' }, data.performance);
  qualityGauge.set({
    line_id: data.lineId,
    asset_id: data.assetId || 'all',
    product_type: 'all'
  }, data.quality);

  logger.debug({ ...data }, 'OEE metrics updated');
}

export function recordProduction(data: {
  lineId: string;
  goodCount: number;
  defectCount: number;
  reworkCount: number;
  productType: string;
  shift: string;
}): void {
  productionCounter.inc({
    line_id: data.lineId,
    status: 'good',
    product_type: data.productType,
    shift: data.shift
  }, data.goodCount);

  if (data.defectCount > 0) {
    defectCounter.inc({
      line_id: data.lineId,
      defect_type: 'unspecified',
      product_type: data.productType,
      severity: 'medium'
    }, data.defectCount);
  }

  if (data.reworkCount > 0) {
    reworkCounter.inc({
      line_id: data.lineId,
      reason: 'unspecified',
      product_type: data.productType
    }, data.reworkCount);
  }
}

export function recordAndonTrigger(data: {
  type: string;
  lineId: string;
  stationId: string;
  severity: string;
  shift: string;
}): void {
  andonCounter.inc({
    type: data.type,
    line_id: data.lineId,
    station_id: data.stationId,
    severity: data.severity,
    shift: data.shift
  });

  activeAndonGauge.inc({
    type: data.type,
    line_id: data.lineId,
    escalation_level: '1'
  });

  logger.info({ ...data }, 'Andon triggered');
}

export function recordAndonResponse(data: {
  type: string;
  lineId: string;
  responseTimeSeconds: number;
  responderRole: string;
}): void {
  andonResponseTime.observe({
    type: data.type,
    line_id: data.lineId,
    responder_role: data.responderRole
  }, data.responseTimeSeconds);
}

export function recordAndonResolution(data: {
  type: string;
  lineId: string;
  resolutionTimeSeconds: number;
  rootCause: string;
}): void {
  andonResolutionTime.observe({
    type: data.type,
    line_id: data.lineId,
    root_cause: data.rootCause
  }, data.resolutionTimeSeconds);

  activeAndonGauge.dec({
    type: data.type,
    line_id: data.lineId,
    escalation_level: '1'
  });
}

export function recordDowntime(data: {
  lineId: string;
  assetId: string;
  minutes: number;
  reason: string;
  category: string;
  shift: string;
}): void {
  downtimeCounter.inc({
    line_id: data.lineId,
    asset_id: data.assetId,
    reason: data.reason,
    category: data.category,
    shift: data.shift
  }, data.minutes);

  downtimeHistogram.observe({
    reason: data.reason,
    category: data.category
  }, data.minutes);
}

export function updateDataIngestionMetrics(data: {
  source: string;
  type: string;
  protocol: string;
  pointsPerSecond: number;
  totalPoints: number;
  status: 'success' | 'failure';
}): void {
  dataIngestionRate.set({
    source: data.source,
    type: data.type,
    protocol: data.protocol
  }, data.pointsPerSecond);

  dataIngestionCounter.inc({
    source: data.source,
    type: data.type,
    status: data.status
  }, data.totalPoints);
}

// Export function to get all business metrics
export function getBusinessMetrics(): string {
  return businessRegistry.metrics();
}

// Initialize periodic metric updates
export function startMetricUpdates(intervalMs: number = 30000): NodeJS.Timer {
  return setInterval(() => {
    // This would typically fetch current values from database
    // and update the gauges accordingly
    logger.debug('Business metrics update cycle completed');
  }, intervalMs);
}