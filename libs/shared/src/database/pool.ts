import { Pool, PoolConfig, Client } from 'pg';
import { createLogger } from '../logger';
import { monitorQuery } from './query-monitor';
import { updateConnectionPoolMetrics, connectionWaitTime } from '../metrics/database';
import crypto from 'crypto';

const logger = createLogger('database-pool');

export interface DatabasePoolConfig extends PoolConfig {
  name?: string;
  statementTimeout?: number;
  queryTimeout?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class DatabasePool {
  private pool: Pool;
  private config: DatabasePoolConfig;
  private activeQueries = 0;
  private totalQueries = 0;
  private failedQueries = 0;
  private slowQueries = 0;
  private readonly slowQueryThreshold = 1000; // 1 second

  constructor(config: DatabasePoolConfig) {
    this.config = {
      // Connection settings
      host: config.host || process.env.DB_HOST || 'localhost',
      port: config.port || parseInt(process.env.DB_PORT || '5432'),
      database: config.database || process.env.DB_NAME || 'ms5db',
      user: config.user || process.env.DB_USER || 'ms5user',
      password: config.password || process.env.DB_PASSWORD,

      // Pool settings
      max: config.max || 20, // Maximum pool size
      min: config.min || 2, // Minimum pool size
      idleTimeoutMillis: config.idleTimeout || 30000, // 30 seconds
      connectionTimeoutMillis: config.connectionTimeout || 2000, // 2 seconds

      // Statement settings
      statement_timeout: config.statementTimeout || 10000, // 10 seconds
      query_timeout: config.queryTimeout || 10000, // 10 seconds

      // Application name for monitoring
      application_name: config.name || 'ms5-app',

      // Keep alive
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,

      ...config
    };

    this.pool = new Pool(this.config);
    this.setupEventHandlers();
    this.setupHealthCheck();
  }

  private setupEventHandlers(): void {
    this.pool.on('connect', (client) => {
      logger.debug({ poolSize: this.pool.totalCount }, 'New client connected to pool');

      // Set runtime parameters for each connection
      client.query(`SET statement_timeout = ${this.config.statement_timeout}`);
      client.query(`SET idle_in_transaction_session_timeout = ${this.config.idleTimeout}`);
      client.query(`SET lock_timeout = 5000`); // 5 seconds for lock acquisition
    });

    this.pool.on('acquire', (client) => {
      this.activeQueries++;
    });

    this.pool.on('release', () => {
      this.activeQueries--;
    });

    this.pool.on('remove', (client) => {
      logger.debug('Client removed from pool');
    });

    this.pool.on('error', (err, client) => {
      logger.error({ error: err }, 'Unexpected error on idle client');
    });
  }

  private setupHealthCheck(): void {
    // Periodic health check every 30 seconds
    setInterval(async () => {
      try {
        const result = await this.pool.query('SELECT 1');
        if (!result) {
          logger.warn('Database health check failed');
        }
      } catch (error) {
        logger.error({ error }, 'Database health check error');
      }
    }, 30000);
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const queryId = crypto.randomBytes(8).toString('hex');
    const start = Date.now();
    this.totalQueries++;

    // Use monitored query execution
    return monitorQuery(
      queryId,
      text,
      async () => {
        const waitStart = Date.now();
        const client = await this.pool.connect();
        const waitDuration = Date.now() - waitStart;

        // Record connection wait time
        connectionWaitTime.observe(
          { pool: this.config.name || 'default' },
          waitDuration / 1000
        );

        try {
          const result = await client.query(text, params);
          const duration = Date.now() - start;

          // Log slow queries
          if (duration > this.slowQueryThreshold) {
            this.slowQueries++;
            logger.warn({
              query: text.substring(0, 100),
              duration,
              params: params?.length
            }, 'Slow query detected');
          }

          // Record metrics
          this.recordMetrics('query', duration, true);

          return result;
        } finally {
          client.release();
        }
      },
      { source: this.config.name }
    ).catch(error => {
      this.failedQueries++;
      const duration = Date.now() - start;

      logger.error({
        query: text.substring(0, 100),
        error,
        duration
      }, 'Query failed');

      this.recordMetrics('query', duration, false);
      throw error;
    });
  }

  async transaction<T>(callback: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const start = Date.now();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');

      const duration = Date.now() - start;
      this.recordMetrics('transaction', duration, true);

      return result;
    } catch (error) {
      await client.query('ROLLBACK');

      const duration = Date.now() - start;
      this.recordMetrics('transaction', duration, false);

      logger.error({ error }, 'Transaction failed');
      throw error;
    } finally {
      client.release();
    }
  }

  async getConnection(): Promise<Client> {
    return this.pool.connect();
  }

  getStats() {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      active: this.activeQueries,
      totalQueries: this.totalQueries,
      failedQueries: this.failedQueries,
      slowQueries: this.slowQueries,
      successRate: this.totalQueries > 0
        ? ((this.totalQueries - this.failedQueries) / this.totalQueries * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  private recordMetrics(operation: string, duration: number, success: boolean): void {
    // Update connection pool metrics
    updateConnectionPoolMetrics(this.config.name || 'default', this.getStats());

    // Log in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug({
        operation,
        duration,
        success,
        stats: this.getStats()
      }, 'Database operation metrics');
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

// Factory functions for creating pools
export function createDatabasePool(config?: DatabasePoolConfig): DatabasePool {
  return new DatabasePool(config || {});
}

export function createReadPool(config?: DatabasePoolConfig): DatabasePool {
  const readConfig: DatabasePoolConfig = {
    ...config,
    host: process.env.DB_READ_HOST || process.env.DB_HOST || 'localhost',
    name: 'ms5-app-read',
    max: 30, // Higher limit for read queries
    statement_timeout: 30000, // 30 seconds for analytical queries
  };

  return new DatabasePool(readConfig);
}

export function createWritePool(config?: DatabasePoolConfig): DatabasePool {
  const writeConfig: DatabasePoolConfig = {
    ...config,
    host: process.env.DB_WRITE_HOST || process.env.DB_HOST || 'localhost',
    name: 'ms5-app-write',
    max: 15, // Lower limit for write queries
    statement_timeout: 5000, // 5 seconds for write operations
  };

  return new DatabasePool(writeConfig);
}

// Connection pool manager for different services
export class PoolManager {
  private static instance: PoolManager;
  private pools: Map<string, DatabasePool> = new Map();

  private constructor() {}

  static getInstance(): PoolManager {
    if (!PoolManager.instance) {
      PoolManager.instance = new PoolManager();
    }
    return PoolManager.instance;
  }

  getPool(name: string = 'default'): DatabasePool {
    if (!this.pools.has(name)) {
      this.pools.set(name, createDatabasePool({ name }));
    }
    return this.pools.get(name)!;
  }

  getReadPool(): DatabasePool {
    if (!this.pools.has('read')) {
      this.pools.set('read', createReadPool());
    }
    return this.pools.get('read')!;
  }

  getWritePool(): DatabasePool {
    if (!this.pools.has('write')) {
      this.pools.set('write', createWritePool());
    }
    return this.pools.get('write')!;
  }

  async closeAll(): Promise<void> {
    for (const [name, pool] of this.pools) {
      await pool.end();
      logger.info({ poolName: name }, 'Pool closed');
    }
    this.pools.clear();
  }

  getStats() {
    const stats: Record<string, any> = {};
    for (const [name, pool] of this.pools) {
      stats[name] = pool.getStats();
    }
    return stats;
  }
}

// Export singleton instance
export const poolManager = PoolManager.getInstance();