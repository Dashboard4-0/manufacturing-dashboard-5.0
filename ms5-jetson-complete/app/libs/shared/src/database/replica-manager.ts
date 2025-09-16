import { DatabasePool, DatabasePoolConfig } from './pool';
import { createLogger } from '../logger';
import { replicationLag } from '../metrics/database';

const logger = createLogger('replica-manager');

export interface ReplicaConfig {
  host: string;
  port?: number;
  weight?: number;
  maxLag?: number; // Maximum acceptable replication lag in seconds
  healthCheckInterval?: number;
  fallbackToMaster?: boolean;
}

export interface ReplicaHealth {
  host: string;
  healthy: boolean;
  lag?: number;
  lastCheck: Date;
  consecutiveFailures: number;
}

export class ReplicaManager {
  private masterPool: DatabasePool;
  private replicaPools: Map<string, DatabasePool> = new Map();
  private replicaConfigs: Map<string, ReplicaConfig> = new Map();
  private replicaHealth: Map<string, ReplicaHealth> = new Map();
  private currentReplicaIndex = 0;
  private healthCheckInterval?: NodeJS.Timer;
  
  private readonly config = {
    maxLag: parseInt(process.env.MAX_REPLICATION_LAG || '10'),
    healthCheckInterval: parseInt(process.env.REPLICA_HEALTH_CHECK_INTERVAL || '30000'),
    maxConsecutiveFailures: parseInt(process.env.MAX_REPLICA_FAILURES || '3'),
    fallbackToMaster: process.env.FALLBACK_TO_MASTER !== 'false'
  };

  constructor(masterConfig: DatabasePoolConfig) {
    this.masterPool = new DatabasePool({
      ...masterConfig,
      name: 'master'
    });
    
    this.initializeReplicas();
    this.startHealthChecks();
  }

  private initializeReplicas(): void {
    // Load replica configurations from environment
    const replicaHosts = process.env.DB_REPLICA_HOSTS?.split(',') || [];
    
    replicaHosts.forEach((host, index) => {
      const replicaConfig: ReplicaConfig = {
        host: host.trim(),
        port: parseInt(process.env[`DB_REPLICA_${index}_PORT`] || process.env.DB_PORT || '5432'),
        weight: parseFloat(process.env[`DB_REPLICA_${index}_WEIGHT`] || '1'),
        maxLag: parseInt(process.env[`DB_REPLICA_${index}_MAX_LAG`] || String(this.config.maxLag)),
        fallbackToMaster: this.config.fallbackToMaster
      };

      this.addReplica(`replica-${index}`, replicaConfig);
    });

    if (replicaHosts.length === 0) {
      logger.info('No read replicas configured, all reads will go to master');
    } else {
      logger.info({ replicas: replicaHosts.length }, 'Read replicas initialized');
    }
  }

  addReplica(name: string, config: ReplicaConfig): void {
    const poolConfig: DatabasePoolConfig = {
      host: config.host,
      port: config.port || parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'ms5db',
      user: process.env.DB_READ_USER || process.env.DB_USER || 'ms5user',
      password: process.env.DB_READ_PASSWORD || process.env.DB_PASSWORD,
      name: `replica-${name}`,
      max: 20,
      statementTimeout: 30000, // 30 seconds for read queries
      connectionTimeout: 5000
    };

    const pool = new DatabasePool(poolConfig);
    this.replicaPools.set(name, pool);
    this.replicaConfigs.set(name, config);
    
    // Initialize health status
    this.replicaHealth.set(name, {
      host: config.host,
      healthy: true,
      lastCheck: new Date(),
      consecutiveFailures: 0
    });

    logger.info({ name, host: config.host }, 'Replica added');
  }

  private startHealthChecks(): void {
    // Initial health check
    this.checkAllReplicasHealth();

    // Periodic health checks
    this.healthCheckInterval = setInterval(
      () => this.checkAllReplicasHealth(),
      this.config.healthCheckInterval
    );
  }

  private async checkAllReplicasHealth(): Promise<void> {
    const checks = Array.from(this.replicaPools.entries()).map(
      ([name, pool]) => this.checkReplicaHealth(name, pool)
    );

    await Promise.allSettled(checks);

    // Log health summary
    const healthSummary = Array.from(this.replicaHealth.values());
    const healthyCount = healthSummary.filter(h => h.healthy).length;
    
    logger.debug({
      healthy: healthyCount,
      total: healthSummary.length,
      replicas: healthSummary.map(h => ({
        host: h.host,
        healthy: h.healthy,
        lag: h.lag
      }))
    }, 'Replica health check completed');
  }

  private async checkReplicaHealth(name: string, pool: DatabasePool): Promise<void> {
    const config = this.replicaConfigs.get(name)!;
    const health = this.replicaHealth.get(name)!;

    try {
      // Check basic connectivity
      const connectResult = await pool.query('SELECT 1');
      if (!connectResult) {
        throw new Error('Connection test failed');
      }

      // Check replication lag
      const lagResult = await pool.query<{ lag_seconds: number }>(`
        SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) AS lag_seconds
      `);

      const lag = lagResult.rows[0]?.lag_seconds || 0;

      // Update metrics
      replicationLag.set({ replica: name }, lag);

      // Check if lag is acceptable
      const maxLag = config.maxLag || this.config.maxLag;
      if (lag > maxLag) {
        throw new Error(`Replication lag ${lag}s exceeds maximum ${maxLag}s`);
      }

      // Mark as healthy
      health.healthy = true;
      health.lag = lag;
      health.consecutiveFailures = 0;
      health.lastCheck = new Date();

    } catch (error) {
      health.consecutiveFailures++;
      health.lastCheck = new Date();

      logger.warn({
        replica: name,
        error: (error as Error).message,
        consecutiveFailures: health.consecutiveFailures
      }, 'Replica health check failed');

      // Mark as unhealthy after too many failures
      if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        health.healthy = false;
        logger.error({
          replica: name,
          failures: health.consecutiveFailures
        }, 'Replica marked as unhealthy');
      }
    }
  }

  getReadPool(): DatabasePool {
    // Get all healthy replicas
    const healthyReplicas = Array.from(this.replicaPools.entries())
      .filter(([name]) => {
        const health = this.replicaHealth.get(name);
        return health?.healthy;
      });

    // If no healthy replicas, fallback to master if configured
    if (healthyReplicas.length === 0) {
      if (this.config.fallbackToMaster) {
        logger.debug('No healthy replicas, falling back to master');
        return this.masterPool;
      }
      throw new Error('No healthy read replicas available');
    }

    // Simple round-robin selection with weight consideration
    const selectedIndex = this.currentReplicaIndex % healthyReplicas.length;
    this.currentReplicaIndex++;

    const [name, pool] = healthyReplicas[selectedIndex];
    logger.debug({ replica: name }, 'Selected read replica');

    return pool;
  }

  getWritePool(): DatabasePool {
    return this.masterPool;
  }

  async getPreferredReadPool(preferMaster: boolean = false): Promise<DatabasePool> {
    if (preferMaster) {
      return this.masterPool;
    }

    try {
      return this.getReadPool();
    } catch (error) {
      if (this.config.fallbackToMaster) {
        logger.warn('Failed to get read pool, using master');
        return this.masterPool;
      }
      throw error;
    }
  }

  // Get pool based on query type
  getPoolForQuery(query: string): DatabasePool {
    const normalizedQuery = query.trim().toUpperCase();
    
    // Write operations go to master
    if (
      normalizedQuery.startsWith('INSERT') ||
      normalizedQuery.startsWith('UPDATE') ||
      normalizedQuery.startsWith('DELETE') ||
      normalizedQuery.startsWith('CREATE') ||
      normalizedQuery.startsWith('ALTER') ||
      normalizedQuery.startsWith('DROP') ||
      normalizedQuery.startsWith('TRUNCATE')
    ) {
      return this.masterPool;
    }

    // Transactions go to master
    if (
      normalizedQuery.startsWith('BEGIN') ||
      normalizedQuery.startsWith('COMMIT') ||
      normalizedQuery.startsWith('ROLLBACK')
    ) {
      return this.masterPool;
    }

    // Reads can go to replicas
    try {
      return this.getReadPool();
    } catch (error) {
      if (this.config.fallbackToMaster) {
        return this.masterPool;
      }
      throw error;
    }
  }

  getReplicaStatus(): Array<{
    name: string;
    config: ReplicaConfig;
    health: ReplicaHealth;
  }> {
    return Array.from(this.replicaPools.keys()).map(name => ({
      name,
      config: this.replicaConfigs.get(name)!,
      health: this.replicaHealth.get(name)!
    }));
  }

  async executeOnAllReplicas<T>(
    query: string,
    params?: any[]
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    // Execute on master
    try {
      const masterResult = await this.masterPool.query<T>(query, params);
      results.set('master', masterResult as any);
    } catch (error) {
      logger.error({ error, pool: 'master' }, 'Query failed on master');
    }

    // Execute on all replicas
    for (const [name, pool] of this.replicaPools.entries()) {
      try {
        const result = await pool.query<T>(query, params);
        results.set(name, result as any);
      } catch (error) {
        logger.error({ error, pool: name }, 'Query failed on replica');
      }
    }

    return results;
  }

  async shutdown(): Promise<void> {
    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close all pools
    const closeTasks = [
      this.masterPool.end(),
      ...Array.from(this.replicaPools.values()).map(pool => pool.end())
    ];

    await Promise.allSettled(closeTasks);
    
    logger.info('Replica manager shut down');
  }
}

// Singleton instance
let replicaManager: ReplicaManager | null = null;

export function initializeReplicaManager(masterConfig?: DatabasePoolConfig): ReplicaManager {
  if (!replicaManager) {
    replicaManager = new ReplicaManager(masterConfig || {});
  }
  return replicaManager;
}

export function getReplicaManager(): ReplicaManager {
  if (!replicaManager) {
    throw new Error('Replica manager not initialized');
  }
  return replicaManager;
}

// Middleware for Express to use appropriate pool
export function replicaMiddleware() {
  return (req: any, res: any, next: any) => {
    const manager = getReplicaManager();
    
    // Attach pools to request
    req.readPool = manager.getReadPool();
    req.writePool = manager.getWritePool();
    req.masterPool = manager.getWritePool();
    
    next();
  };
}