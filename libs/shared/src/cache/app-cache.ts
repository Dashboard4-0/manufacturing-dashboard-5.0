import { Redis } from 'ioredis';
import { createLogger } from '../logger';
import { cacheHitRatio, cacheSize, cacheEvictions } from '../metrics/database';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const logger = createLogger('app-cache');

export interface CacheStrategy {
  ttl: number;
  compress?: boolean;
  keyPrefix?: string;
  invalidateOn?: string[];
  refreshInterval?: number;
  staleWhileRevalidate?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  metadata: {
    created: Date;
    expires: Date;
    hits: number;
    compressed: boolean;
    size: number;
    etag?: string;
  };
}

export class ApplicationCache {
  private redis: Redis;
  private localCache = new Map<string, CacheEntry<any>>();
  private strategies = new Map<string, CacheStrategy>();
  private refreshTimers = new Map<string, NodeJS.Timer>();
  private stats = {
    hits: 0,
    misses: 0,
    localHits: 0,
    redisHits: 0
  };

  constructor(
    private config: {
      redis?: Redis;
      enableLocalCache?: boolean;
      localCacheMaxSize?: number;
      defaultTTL?: number;
      compressionThreshold?: number;
    } = {}
  ) {
    this.config = {
      enableLocalCache: config.enableLocalCache ?? true,
      localCacheMaxSize: config.localCacheMaxSize ?? 100,
      defaultTTL: config.defaultTTL ?? 300,
      compressionThreshold: config.compressionThreshold ?? 1024,
      ...config
    };

    this.redis = config.redis || new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: 'ms5:app:',
      enableReadyCheck: true
    });

    this.startMetricsReporting();
    this.setupCacheStrategies();
  }

  private setupCacheStrategies(): void {
    // Define caching strategies for different data types
    this.defineStrategy('user', {
      ttl: 3600, // 1 hour
      keyPrefix: 'user:',
      invalidateOn: ['user.update', 'user.delete']
    });

    this.defineStrategy('line-status', {
      ttl: 30, // 30 seconds
      keyPrefix: 'line:status:',
      refreshInterval: 25, // Refresh 5 seconds before expiry
      staleWhileRevalidate: true
    });

    this.defineStrategy('oee-metrics', {
      ttl: 60, // 1 minute
      keyPrefix: 'oee:',
      compress: true,
      staleWhileRevalidate: true
    });

    this.defineStrategy('andon-calls', {
      ttl: 10, // 10 seconds for real-time data
      keyPrefix: 'andon:',
      invalidateOn: ['andon.trigger', 'andon.acknowledge', 'andon.resolve']
    });

    this.defineStrategy('sqdc-board', {
      ttl: 300, // 5 minutes
      keyPrefix: 'sqdc:',
      compress: true,
      invalidateOn: ['sqdc.update']
    });

    this.defineStrategy('telemetry', {
      ttl: 5, // 5 seconds for sensor data
      keyPrefix: 'telemetry:',
      staleWhileRevalidate: true
    });

    this.defineStrategy('report', {
      ttl: 1800, // 30 minutes
      keyPrefix: 'report:',
      compress: true
    });

    this.defineStrategy('config', {
      ttl: 86400, // 24 hours
      keyPrefix: 'config:',
      invalidateOn: ['config.update']
    });
  }

  defineStrategy(name: string, strategy: CacheStrategy): void {
    this.strategies.set(name, strategy);
    logger.debug({ name, strategy }, 'Cache strategy defined');
  }

  private async compress(data: string): Promise<Buffer> {
    if (data.length < this.config.compressionThreshold!) {
      return Buffer.from(data);
    }
    return gzip(data);
  }

  private async decompress(data: Buffer, compressed: boolean): Promise<string> {
    if (!compressed) {
      return data.toString();
    }
    const decompressed = await gunzip(data);
    return decompressed.toString();
  }

  async get<T>(
    key: string,
    strategyName?: string
  ): Promise<T | null> {
    const strategy = strategyName ? this.strategies.get(strategyName) : null;
    const fullKey = this.buildKey(key, strategy);

    // Check local cache first
    if (this.config.enableLocalCache) {
      const local = this.localCache.get(fullKey);
      if (local && local.metadata.expires > new Date()) {
        this.stats.hits++;
        this.stats.localHits++;
        local.metadata.hits++;
        return local.data as T;
      }
    }

    // Check Redis
    try {
      const cached = await this.redis.get(fullKey);
      if (cached) {
        const entry: CacheEntry<T> = JSON.parse(cached);
        
        // Check if expired
        if (new Date(entry.metadata.expires) > new Date()) {
          this.stats.hits++;
          this.stats.redisHits++;
          
          // Store in local cache
          if (this.config.enableLocalCache) {
            this.setLocal(fullKey, entry);
          }

          // Handle stale-while-revalidate
          if (strategy?.staleWhileRevalidate) {
            const ttl = strategy.ttl * 1000;
            const age = Date.now() - new Date(entry.metadata.created).getTime();
            if (age > ttl * 0.75) {
              // Data is stale, trigger background refresh
              this.emit('stale', { key, strategy: strategyName });
            }
          }

          return entry.data;
        }
      }
    } catch (error) {
      logger.error({ error, key: fullKey }, 'Cache get error');
    }

    this.stats.misses++;
    return null;
  }

  async set<T>(
    key: string,
    data: T,
    strategyName?: string,
    options: { ttl?: number; compress?: boolean } = {}
  ): Promise<void> {
    const strategy = strategyName ? this.strategies.get(strategyName) : null;
    const fullKey = this.buildKey(key, strategy);
    const ttl = options.ttl || strategy?.ttl || this.config.defaultTTL!;
    const shouldCompress = options.compress ?? strategy?.compress ?? false;

    try {
      const jsonData = JSON.stringify(data);
      const compressed = shouldCompress && jsonData.length > this.config.compressionThreshold!;

      const entry: CacheEntry<T> = {
        data,
        metadata: {
          created: new Date(),
          expires: new Date(Date.now() + ttl * 1000),
          hits: 0,
          compressed,
          size: jsonData.length,
          etag: this.generateETag(jsonData)
        }
      };

      // Store in Redis
      await this.redis.setex(fullKey, ttl, JSON.stringify(entry));

      // Store in local cache
      if (this.config.enableLocalCache) {
        this.setLocal(fullKey, entry);
      }

      // Set up refresh timer if needed
      if (strategy?.refreshInterval) {
        this.setupRefreshTimer(key, strategyName!, strategy.refreshInterval);
      }

      logger.debug({
        key: fullKey,
        ttl,
        size: entry.metadata.size,
        compressed
      }, 'Cache set');
    } catch (error) {
      logger.error({ error, key: fullKey }, 'Cache set error');
    }
  }

  private setLocal<T>(key: string, entry: CacheEntry<T>): void {
    // Implement LRU eviction if needed
    if (this.localCache.size >= this.config.localCacheMaxSize!) {
      const oldestKey = this.localCache.keys().next().value;
      this.localCache.delete(oldestKey);
      cacheEvictions.inc({ cache_type: 'local', reason: 'size' });
    }

    this.localCache.set(key, entry);
  }

  private buildKey(key: string, strategy: CacheStrategy | null): string {
    const prefix = strategy?.keyPrefix || '';
    return `${prefix}${key}`;
  }

  private generateETag(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private setupRefreshTimer(key: string, strategyName: string, interval: number): void {
    const timerId = `${strategyName}:${key}`;
    
    // Clear existing timer
    if (this.refreshTimers.has(timerId)) {
      clearInterval(this.refreshTimers.get(timerId)!);
    }

    // Set new timer
    const timer = setInterval(() => {
      this.emit('refresh', { key, strategy: strategyName });
    }, interval * 1000);

    this.refreshTimers.set(timerId, timer);
  }

  async invalidate(pattern: string): Promise<number> {
    let count = 0;

    // Invalidate from local cache
    for (const key of this.localCache.keys()) {
      if (key.includes(pattern)) {
        this.localCache.delete(key);
        count++;
      }
    }

    // Invalidate from Redis
    try {
      const keys = await this.redis.keys(`*${pattern}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        count += keys.length;
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache invalidation error');
    }

    logger.info({ pattern, count }, 'Cache invalidated');
    return count;
  }

  async invalidateByStrategy(strategyName: string): Promise<number> {
    const strategy = this.strategies.get(strategyName);
    if (!strategy) return 0;

    return this.invalidate(strategy.keyPrefix || strategyName);
  }

  async warmUp(keys: Array<{ key: string; loader: () => Promise<any>; strategy?: string }>): Promise<void> {
    logger.info({ count: keys.length }, 'Cache warm-up starting');

    const tasks = keys.map(async ({ key, loader, strategy }) => {
      try {
        const cached = await this.get(key, strategy);
        if (!cached) {
          const data = await loader();
          await this.set(key, data, strategy);
        }
      } catch (error) {
        logger.error({ error, key }, 'Cache warm-up error');
      }
    });

    await Promise.allSettled(tasks);
    logger.info('Cache warm-up completed');
  }

  private startMetricsReporting(): void {
    setInterval(() => {
      const total = this.stats.hits + this.stats.misses;
      if (total > 0) {
        const hitRatio = this.stats.hits / total;
        cacheHitRatio.set({ cache_type: 'application' }, hitRatio);

        // Calculate cache size
        let totalSize = 0;
        for (const entry of this.localCache.values()) {
          totalSize += entry.metadata.size;
        }
        cacheSize.set({ cache_type: 'application' }, totalSize);

        logger.debug({
          hits: this.stats.hits,
          misses: this.stats.misses,
          hitRatio: (hitRatio * 100).toFixed(2) + '%',
          localCacheSize: this.localCache.size,
          localCacheBytes: totalSize
        }, 'Cache metrics');
      }
    }, 30000);
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      localHits: this.stats.localHits,
      redisHits: this.stats.redisHits,
      hitRatio: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      localCacheSize: this.localCache.size,
      strategies: Array.from(this.strategies.keys())
    };
  }

  async close(): Promise<void> {
    // Clear all timers
    for (const timer of this.refreshTimers.values()) {
      clearInterval(timer);
    }
    this.refreshTimers.clear();

    // Clear local cache
    this.localCache.clear();

    // Close Redis connection
    await this.redis.quit();
    
    logger.info('Application cache closed');
  }

  // Event emitter functionality
  private listeners = new Map<string, Set<Function>>();

  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(data);
      }
    }
  }
}

// Singleton instance
let appCache: ApplicationCache | null = null;

export function initializeAppCache(config?: any): ApplicationCache {
  if (!appCache) {
    appCache = new ApplicationCache(config);
  }
  return appCache;
}

export function getAppCache(): ApplicationCache {
  if (!appCache) {
    appCache = new ApplicationCache();
  }
  return appCache;
}

// Cache decorator
export function Cached(strategyName: string, keyGenerator?: (args: any[]) => string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cache = getAppCache();
      const key = keyGenerator ? keyGenerator(args) : `${propertyKey}:${JSON.stringify(args)}`;

      // Try cache first
      const cached = await cache.get(key, strategyName);
      if (cached !== null) {
        return cached;
      }

      // Execute method and cache result
      const result = await originalMethod.apply(this, args);
      await cache.set(key, result, strategyName);

      return result;
    };

    return descriptor;
  };
}

// Cache invalidation decorator
export function InvalidatesCache(patterns: string[]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      // Invalidate cache patterns
      const cache = getAppCache();
      for (const pattern of patterns) {
        await cache.invalidate(pattern);
      }

      return result;
    };

    return descriptor;
  };
}