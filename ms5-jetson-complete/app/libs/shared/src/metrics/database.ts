import { Counter, Gauge, Histogram, register } from 'prom-client';

// Query performance metrics
export const queryDurationHistogram = new Histogram({
  name: 'ms5_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'source'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

export const queryCounter = new Counter({
  name: 'ms5_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'status', 'source'],
  registers: [register]
});

export const slowQueryGauge = new Gauge({
  name: 'ms5_slow_queries_current',
  help: 'Current number of slow queries',
  labelNames: ['source'],
  registers: [register]
});

export const activeQueriesGauge = new Gauge({
  name: 'ms5_active_queries',
  help: 'Number of currently executing queries',
  registers: [register]
});

export const queryErrorCounter = new Counter({
  name: 'ms5_query_errors_total',
  help: 'Total number of query errors',
  labelNames: ['error_type', 'source'],
  registers: [register]
});

// Connection pool metrics
export const connectionPoolGauge = new Gauge({
  name: 'ms5_db_pool_connections',
  help: 'Database connection pool status',
  labelNames: ['pool', 'state'],
  registers: [register]
});

export const connectionWaitTime = new Histogram({
  name: 'ms5_db_connection_wait_seconds',
  help: 'Time spent waiting for a database connection',
  labelNames: ['pool'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register]
});

// Transaction metrics
export const transactionDuration = new Histogram({
  name: 'ms5_transaction_duration_seconds',
  help: 'Database transaction duration',
  labelNames: ['source', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register]
});

export const transactionCounter = new Counter({
  name: 'ms5_transactions_total',
  help: 'Total number of database transactions',
  labelNames: ['status', 'source'],
  registers: [register]
});

// Cache metrics
export const cacheHitRatio = new Gauge({
  name: 'ms5_query_cache_hit_ratio',
  help: 'Query cache hit ratio',
  labelNames: ['cache_type'],
  registers: [register]
});

export const cacheSize = new Gauge({
  name: 'ms5_query_cache_size_bytes',
  help: 'Query cache size in bytes',
  labelNames: ['cache_type'],
  registers: [register]
});

export const cacheEvictions = new Counter({
  name: 'ms5_query_cache_evictions_total',
  help: 'Total number of cache evictions',
  labelNames: ['cache_type', 'reason'],
  registers: [register]
});

// Replication lag metrics
export const replicationLag = new Gauge({
  name: 'ms5_replication_lag_seconds',
  help: 'Database replication lag in seconds',
  labelNames: ['replica'],
  registers: [register]
});

// Lock metrics
export const lockWaitTime = new Histogram({
  name: 'ms5_lock_wait_seconds',
  help: 'Time spent waiting for database locks',
  labelNames: ['lock_type', 'table'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 5, 10, 30],
  registers: [register]
});

export const deadlockCounter = new Counter({
  name: 'ms5_deadlocks_total',
  help: 'Total number of deadlocks detected',
  labelNames: ['source'],
  registers: [register]
});

// Index usage metrics
export const indexHitRatio = new Gauge({
  name: 'ms5_index_hit_ratio',
  help: 'Database index hit ratio',
  labelNames: ['table'],
  registers: [register]
});

export const sequentialScans = new Counter({
  name: 'ms5_sequential_scans_total',
  help: 'Total number of sequential scans',
  labelNames: ['table'],
  registers: [register]
});

// Helper functions for updating metrics
export function updateConnectionPoolMetrics(poolName: string, stats: {
  total: number;
  idle: number;
  waiting: number;
  active: number;
}): void {
  connectionPoolGauge.set({ pool: poolName, state: 'total' }, stats.total);
  connectionPoolGauge.set({ pool: poolName, state: 'idle' }, stats.idle);
  connectionPoolGauge.set({ pool: poolName, state: 'waiting' }, stats.waiting);
  connectionPoolGauge.set({ pool: poolName, state: 'active' }, stats.active);
}

export function recordQueryPerformance(
  operation: string,
  source: string,
  duration: number,
  success: boolean
): void {
  queryDurationHistogram.observe({ operation, source }, duration / 1000);
  queryCounter.inc({ 
    operation, 
    status: success ? 'success' : 'failure',
    source 
  });
}

export function recordTransactionMetrics(
  source: string,
  duration: number,
  success: boolean
): void {
  transactionDuration.observe(
    { source, status: success ? 'success' : 'failure' },
    duration / 1000
  );
  transactionCounter.inc({
    status: success ? 'success' : 'failure',
    source
  });
}

export function updateCacheMetrics(stats: {
  hits: number;
  misses: number;
  size?: number;
  evictions?: number;
}): void {
  const hitRatio = stats.hits + stats.misses > 0
    ? stats.hits / (stats.hits + stats.misses)
    : 0;
  
  cacheHitRatio.set({ cache_type: 'query' }, hitRatio);
  
  if (stats.size !== undefined) {
    cacheSize.set({ cache_type: 'query' }, stats.size);
  }
  
  if (stats.evictions !== undefined) {
    cacheEvictions.inc({ cache_type: 'query', reason: 'size' }, stats.evictions);
  }
}