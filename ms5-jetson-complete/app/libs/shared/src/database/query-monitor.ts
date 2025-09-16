import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import { 
  queryDurationHistogram,
  queryCounter,
  slowQueryGauge,
  activeQueriesGauge,
  queryErrorCounter,
  connectionPoolGauge
} from '../metrics/database';

const logger = createLogger('query-monitor');

export interface QueryMetrics {
  query: string;
  params?: any[];
  duration: number;
  rowCount: number;
  startTime: Date;
  endTime: Date;
  success: boolean;
  error?: Error;
  source?: string;
  userId?: string;
  tenantId?: string;
}

export interface QueryPerformanceReport {
  period: string;
  totalQueries: number;
  averageDuration: number;
  medianDuration: number;
  p95Duration: number;
  p99Duration: number;
  slowQueries: QueryMetrics[];
  errorRate: number;
  topQueries: Array<{
    query: string;
    count: number;
    avgDuration: number;
  }>;
}

export interface SlowQueryAlert {
  query: string;
  duration: number;
  threshold: number;
  timestamp: Date;
  userId?: string;
  source?: string;
}

export class QueryMonitor extends EventEmitter {
  private queries: QueryMetrics[] = [];
  private slowQueries: QueryMetrics[] = [];
  private queryStats = new Map<string, {
    count: number;
    totalDuration: number;
    errors: number;
  }>();
  
  private readonly config = {
    slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD || '1000'),
    maxQueryHistory: parseInt(process.env.MAX_QUERY_HISTORY || '10000'),
    maxSlowQueries: parseInt(process.env.MAX_SLOW_QUERIES || '100'),
    alertThreshold: parseInt(process.env.QUERY_ALERT_THRESHOLD || '5000'),
    samplingRate: parseFloat(process.env.QUERY_SAMPLING_RATE || '1.0')
  };

  private activeQueries = new Map<string, {
    query: string;
    startTime: number;
    timeout?: NodeJS.Timeout;
  }>();

  constructor() {
    super();
    this.startReporting();
    this.setupAlertHandlers();
  }

  private startReporting(): void {
    // Report metrics every 30 seconds
    setInterval(() => {
      this.reportMetrics();
    }, 30000);

    // Clean up old data every minute
    setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private setupAlertHandlers(): void {
    this.on('slowQuery', (alert: SlowQueryAlert) => {
      logger.warn({
        query: alert.query.substring(0, 200),
        duration: alert.duration,
        threshold: alert.threshold,
        userId: alert.userId,
        source: alert.source
      }, 'Slow query detected');

      // Update metrics
      slowQueryGauge.inc({ source: alert.source || 'unknown' });
    });

    this.on('queryTimeout', (query: string, duration: number) => {
      logger.error({
        query: query.substring(0, 200),
        duration
      }, 'Query timeout');

      queryErrorCounter.inc({ 
        error_type: 'timeout',
        source: 'unknown'
      });
    });
  }

  recordQueryStart(queryId: string, query: string): void {
    const timeout = setTimeout(() => {
      this.emit('queryTimeout', query, Date.now() - this.activeQueries.get(queryId)!.startTime);
      this.activeQueries.delete(queryId);
    }, this.config.alertThreshold * 2);

    this.activeQueries.set(queryId, {
      query,
      startTime: Date.now(),
      timeout
    });

    activeQueriesGauge.set(this.activeQueries.size);
  }

  recordQueryEnd(
    queryId: string,
    result: { rowCount: number; success: boolean; error?: Error },
    metadata?: { userId?: string; tenantId?: string; source?: string }
  ): void {
    const queryInfo = this.activeQueries.get(queryId);
    if (!queryInfo) return;

    // Clear timeout
    if (queryInfo.timeout) {
      clearTimeout(queryInfo.timeout);
    }

    const duration = Date.now() - queryInfo.startTime;
    const query = queryInfo.query;

    this.activeQueries.delete(queryId);
    activeQueriesGauge.set(this.activeQueries.size);

    // Sample queries based on configuration
    if (Math.random() > this.config.samplingRate && duration < this.config.slowQueryThreshold) {
      return;
    }

    const metrics: QueryMetrics = {
      query,
      duration,
      rowCount: result.rowCount,
      startTime: new Date(queryInfo.startTime),
      endTime: new Date(),
      success: result.success,
      error: result.error,
      ...metadata
    };

    // Record in history
    this.queries.push(metrics);

    // Track slow queries
    if (duration > this.config.slowQueryThreshold) {
      this.slowQueries.push(metrics);
      this.emit('slowQuery', {
        query,
        duration,
        threshold: this.config.slowQueryThreshold,
        timestamp: new Date(),
        ...metadata
      });
    }

    // Alert on very slow queries
    if (duration > this.config.alertThreshold) {
      this.emit('criticalSlowQuery', metrics);
    }

    // Update statistics
    this.updateStats(query, duration, result.success);

    // Update Prometheus metrics
    queryDurationHistogram.observe(
      {
        operation: this.getOperationType(query),
        source: metadata?.source || 'unknown'
      },
      duration / 1000 // Convert to seconds
    );

    queryCounter.inc({
      operation: this.getOperationType(query),
      status: result.success ? 'success' : 'failure',
      source: metadata?.source || 'unknown'
    });

    if (!result.success && result.error) {
      queryErrorCounter.inc({
        error_type: this.getErrorType(result.error),
        source: metadata?.source || 'unknown'
      });
    }
  }

  private updateStats(query: string, duration: number, success: boolean): void {
    const normalizedQuery = this.normalizeQuery(query);
    const stats = this.queryStats.get(normalizedQuery) || {
      count: 0,
      totalDuration: 0,
      errors: 0
    };

    stats.count++;
    stats.totalDuration += duration;
    if (!success) stats.errors++;

    this.queryStats.set(normalizedQuery, stats);
  }

  private normalizeQuery(query: string): string {
    // Remove values to group similar queries
    return query
      .replace(/\$\d+/g, '$?') // PostgreSQL placeholders
      .replace(/\b\d+\b/g, '?') // Numbers
      .replace(/'[^']*'/g, '?') // String literals
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .substring(0, 200); // Limit length
  }

  private getOperationType(query: string): string {
    const normalized = query.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) return 'select';
    if (normalized.startsWith('INSERT')) return 'insert';
    if (normalized.startsWith('UPDATE')) return 'update';
    if (normalized.startsWith('DELETE')) return 'delete';
    if (normalized.startsWith('BEGIN') || normalized.startsWith('COMMIT')) return 'transaction';
    return 'other';
  }

  private getErrorType(error: Error): string {
    const message = error.message.toLowerCase();
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('connection')) return 'connection';
    if (message.includes('constraint')) return 'constraint';
    if (message.includes('permission') || message.includes('denied')) return 'permission';
    if (message.includes('syntax')) return 'syntax';
    return 'unknown';
  }

  private reportMetrics(): void {
    if (this.queries.length === 0) return;

    const report = this.generateReport('last_30s');
    
    logger.info({
      totalQueries: report.totalQueries,
      avgDuration: report.averageDuration,
      p95Duration: report.p95Duration,
      errorRate: report.errorRate,
      slowQueryCount: this.slowQueries.length,
      activeQueries: this.activeQueries.size
    }, 'Query performance report');

    // Emit for external monitoring
    this.emit('performanceReport', report);
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    // Clean up old queries
    this.queries = this.queries.filter(
      q => now - q.startTime.getTime() < maxAge
    ).slice(-this.config.maxQueryHistory);

    // Clean up slow queries
    this.slowQueries = this.slowQueries
      .slice(-this.config.maxSlowQueries);

    // Clean up stats for queries not seen recently
    const staleThreshold = now - 60 * 60 * 1000; // 1 hour
    for (const [query, stats] of this.queryStats.entries()) {
      if (stats.count === 0) {
        this.queryStats.delete(query);
      }
    }
  }

  generateReport(period: string): QueryPerformanceReport {
    const durations = this.queries
      .filter(q => q.success)
      .map(q => q.duration)
      .sort((a, b) => a - b);

    const totalQueries = this.queries.length;
    const failedQueries = this.queries.filter(q => !q.success).length;

    // Calculate percentiles
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);
    const medianIndex = Math.floor(durations.length * 0.5);

    // Get top queries by frequency and duration
    const topQueries = Array.from(this.queryStats.entries())
      .map(([query, stats]) => ({
        query,
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      period,
      totalQueries,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
      medianDuration: durations[medianIndex] || 0,
      p95Duration: durations[p95Index] || 0,
      p99Duration: durations[p99Index] || 0,
      slowQueries: this.slowQueries.slice(-10),
      errorRate: totalQueries > 0 ? (failedQueries / totalQueries) : 0,
      topQueries
    };
  }

  getSlowQueries(limit: number = 10): QueryMetrics[] {
    return this.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  getQueryStats(): Map<string, any> {
    return new Map(this.queryStats);
  }

  reset(): void {
    this.queries = [];
    this.slowQueries = [];
    this.queryStats.clear();
    logger.info('Query monitor reset');
  }
}

// Singleton instance
export const queryMonitor = new QueryMonitor();

// Helper function to wrap database queries with monitoring
export function monitorQuery<T>(
  queryId: string,
  query: string,
  executeQuery: () => Promise<T>,
  metadata?: { userId?: string; tenantId?: string; source?: string }
): Promise<T> {
  queryMonitor.recordQueryStart(queryId, query);

  return executeQuery()
    .then(result => {
      queryMonitor.recordQueryEnd(queryId, {
        rowCount: (result as any)?.rowCount || 0,
        success: true
      }, metadata);
      return result;
    })
    .catch(error => {
      queryMonitor.recordQueryEnd(queryId, {
        rowCount: 0,
        success: false,
        error
      }, metadata);
      throw error;
    });
}

// Decorator for monitoring class methods
export function MonitorQuery(source?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const queryId = `${target.constructor.name}.${propertyKey}.${Date.now()}`;
      const query = args[0] || propertyKey;
      const metadata = {
        source: source || target.constructor.name,
        userId: (this as any).userId,
        tenantId: (this as any).tenantId
      };

      return monitorQuery(
        queryId,
        query,
        () => originalMethod.apply(this, args),
        metadata
      );
    };

    return descriptor;
  };
}