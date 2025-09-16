import { Redis } from 'ioredis';
import crypto from 'crypto';
import { createLogger } from '../logger';
import { DatabasePool } from '../database/pool';

const logger = createLogger('query-cache');

export interface CacheConfig {
  defaultTTL?: number;
  maxSize?: number;
  enableCompression?: boolean;
  keyPrefix?: string;
  redis?: Redis;
}

export interface CacheOptions {
  ttl?: number;
  key?: string;
  invalidateOn?: string[];
  compress?: boolean;
  cacheNull?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
  hitRate: string;
  avgResponseTime: number;
}

export class QueryCache {
  private redis: Redis;
  private config: Required<CacheConfig>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
    hitRate: '0%',
    avgResponseTime: 0
  };
  private responseTimes: number[] = [];
  private invalidationPatterns: Map<string, Set<string>> = new Map();

  constructor(config: CacheConfig = {}) {
    this.config = {
      defaultTTL: config.defaultTTL || 300, // 5 minutes
      maxSize: config.maxSize || 1000000, // 1MB per entry
      enableCompression: config.enableCompression || false,
      keyPrefix: config.keyPrefix || 'qc:',
      redis: config.redis || new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        keyPrefix: 'ms5:cache:',
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 50, 2000)
      })
    };

    this.redis = this.config.redis;
    this.setupEventHandlers();
    this.startStatsReporting();
  }

  private setupEventHandlers(): void {
    this.redis.on('error', (error) => {
      logger.error({ error }, 'Redis connection error');
      this.stats.errors++;
    });

    this.redis.on('connect', () => {
      logger.info('Redis cache connected');
    });

    this.redis.on('ready', () => {
      logger.info('Redis cache ready');
    });
  }

  private startStatsReporting(): void {
    // Report cache stats every minute
    setInterval(() => {
      const total = this.stats.hits + this.stats.misses;
      if (total > 0) {
        this.stats.hitRate = ((this.stats.hits / total) * 100).toFixed(2) + '%';
        this.stats.avgResponseTime = this.responseTimes.length > 0
          ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
          : 0;

        logger.info({
          stats: this.stats,
          memory: process.memoryUsage()
        }, 'Cache statistics');

        // Reset response times array to prevent memory leak
        if (this.responseTimes.length > 1000) {
          this.responseTimes = this.responseTimes.slice(-100);
        }
      }
    }, 60000);
  }

  private generateKey(query: string, params?: any[]): string {
    const hash = crypto
      .createHash('md5')
      .update(query + JSON.stringify(params || []))
      .digest('hex');
    return `${this.config.keyPrefix}${hash}`;
  }

  async get<T>(
    query: string,
    params?: any[],
    options: CacheOptions = {}
  ): Promise<T | null> {
    const start = Date.now();
    const key = options.key || this.generateKey(query, params);

    try {
      const cached = await this.redis.get(key);

      if (cached) {
        this.stats.hits++;
        const duration = Date.now() - start;
        this.responseTimes.push(duration);

        logger.debug({
          key,
          duration,
          size: cached.length
        }, 'Cache hit');

        const data = this.config.enableCompression || options.compress
          ? await this.decompress(cached)
          : cached;

        return JSON.parse(data);
      }

      this.stats.misses++;
      logger.debug({ key }, 'Cache miss');
      return null;
    } catch (error) {
      this.stats.errors++;
      logger.error({ error, key }, 'Cache get error');
      return null;
    }
  }

  async set<T>(
    query: string,
    params: any[] | undefined,
    data: T,
    options: CacheOptions = {}
  ): Promise<void> {
    // Don't cache null/undefined unless explicitly allowed
    if (data === null || data === undefined) {
      if (!options.cacheNull) {
        return;
      }
    }

    const key = options.key || this.generateKey(query, params);
    const ttl = options.ttl || this.config.defaultTTL;

    try {
      const jsonData = JSON.stringify(data);

      // Check size limit
      if (jsonData.length > this.config.maxSize) {
        logger.warn({
          key,
          size: jsonData.length,
          maxSize: this.config.maxSize
        }, 'Data too large to cache');
        return;
      }

      const finalData = this.config.enableCompression || options.compress
        ? await this.compress(jsonData)
        : jsonData;

      await this.redis.setex(key, ttl, finalData);
      this.stats.sets++;

      // Register invalidation patterns
      if (options.invalidateOn) {
        for (const pattern of options.invalidateOn) {
          if (!this.invalidationPatterns.has(pattern)) {
            this.invalidationPatterns.set(pattern, new Set());
          }
          this.invalidationPatterns.get(pattern)!.add(key);
        }
      }

      logger.debug({
        key,
        ttl,
        size: finalData.length
      }, 'Cache set');
    } catch (error) {
      this.stats.errors++;
      logger.error({ error, key }, 'Cache set error');
    }
  }

  async invalidate(pattern: string): Promise<number> {
    try {
      // Invalidate by pattern
      const keys = await this.redis.keys(`${this.config.keyPrefix}${pattern}*`);
      let deleted = 0;

      if (keys.length > 0) {
        deleted = await this.redis.del(...keys);
        this.stats.deletes += deleted;
      }

      // Invalidate registered patterns
      if (this.invalidationPatterns.has(pattern)) {
        const registeredKeys = this.invalidationPatterns.get(pattern)!;
        for (const key of registeredKeys) {
          await this.redis.del(key);
          deleted++;
        }
        this.invalidationPatterns.delete(pattern);
      }

      logger.info({ pattern, deleted }, 'Cache invalidated');
      return deleted;
    } catch (error) {
      this.stats.errors++;
      logger.error({ error, pattern }, 'Cache invalidation error');
      return 0;
    }
  }

  async invalidateAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.config.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.stats.deletes += keys.length;
      }
      this.invalidationPatterns.clear();
      logger.info({ count: keys.length }, 'All cache cleared');
    } catch (error) {
      this.stats.errors++;
      logger.error({ error }, 'Cache clear error');
    }
  }

  private async compress(data: string): Promise<string> {
    // For now, just return the data
    // In production, use zlib or similar
    return data;
  }

  private async decompress(data: string): Promise<string> {
    // For now, just return the data
    // In production, use zlib or similar
    return data;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('Cache connection closed');
  }
}

// Cached database query wrapper
export class CachedDatabase {
  constructor(
    private pool: DatabasePool,
    private cache: QueryCache
  ) {}

  async query<T = any>(
    text: string,
    params?: any[],
    options: CacheOptions = {}
  ): Promise<{ rows: T[]; rowCount: number }> {
    // Try to get from cache first
    const cached = await this.cache.get<{ rows: T[]; rowCount: number }>(
      text,
      params,
      options
    );

    if (cached) {
      return cached;
    }

    // Execute query
    const result = await this.pool.query<T>(text, params);

    // Cache the result
    await this.cache.set(text, params, result, options);

    return result;
  }

  async queryOne<T = any>(
    text: string,
    params?: any[],
    options: CacheOptions = {}
  ): Promise<T | null> {
    const result = await this.query<T>(text, params, options);
    return result.rows[0] || null;
  }

  async queryMany<T = any>(
    text: string,
    params?: any[],
    options: CacheOptions = {}
  ): Promise<T[]> {
    const result = await this.query<T>(text, params, options);
    return result.rows;
  }

  // Write operations that invalidate cache
  async insert<T = any>(
    table: string,
    data: Record<string, any>,
    returning?: string
  ): Promise<T | null> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const query = returning
      ? `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING ${returning}`
      : `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

    const result = await this.pool.query<T>(query, values);

    // Invalidate related cache
    await this.cache.invalidate(table);

    return returning ? result.rows[0] : null;
  }

  async update<T = any>(
    table: string,
    data: Record<string, any>,
    where: Record<string, any>,
    returning?: string
  ): Promise<T[]> {
    const setClause = Object.keys(data)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(', ');

    const whereClause = Object.keys(where)
      .map((key, i) => `${key} = $${Object.keys(data).length + i + 1}`)
      .join(' AND ');

    const query = returning
      ? `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING ${returning}`
      : `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    const result = await this.pool.query<T>(
      query,
      [...Object.values(data), ...Object.values(where)]
    );

    // Invalidate related cache
    await this.cache.invalidate(table);

    return result.rows;
  }

  async delete(
    table: string,
    where: Record<string, any>
  ): Promise<number> {
    const whereClause = Object.keys(where)
      .map((key, i) => `${key} = $${i + 1}`)
      .join(' AND ');

    const query = `DELETE FROM ${table} WHERE ${whereClause}`;

    const result = await this.pool.query(query, Object.values(where));

    // Invalidate related cache
    await this.cache.invalidate(table);

    return result.rowCount;
  }
}

// Cache decorators for methods
export function Cacheable(options: CacheOptions = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cache = (this as any).cache as QueryCache;
      if (!cache) {
        return originalMethod.apply(this, args);
      }

      const cacheKey = `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;
      const cached = await cache.get(cacheKey, [], { ...options, key: cacheKey });

      if (cached) {
        return cached;
      }

      const result = await originalMethod.apply(this, args);
      await cache.set(cacheKey, [], result, { ...options, key: cacheKey });

      return result;
    };

    return descriptor;
  };
}

export function CacheInvalidate(patterns: string[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      const cache = (this as any).cache as QueryCache;
      if (cache) {
        for (const pattern of patterns) {
          await cache.invalidate(pattern);
        }
      }

      return result;
    };

    return descriptor;
  };
}