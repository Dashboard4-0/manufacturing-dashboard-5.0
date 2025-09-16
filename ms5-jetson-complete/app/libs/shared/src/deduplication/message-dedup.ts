import { Redis } from 'ioredis';
import { createLogger } from '../logger';
import crypto from 'crypto';
import { EventEmitter } from 'events';

const logger = createLogger('message-deduplication');

export interface DeduplicationConfig {
  windowSize?: number;
  ttl?: number;
  hashFunction?: (message: any) => string;
  redis?: Redis;
  enableMetrics?: boolean;
  maxCacheSize?: number;
}

export interface DuplicateInfo {
  messageId: string;
  hash: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  metadata?: Record<string, any>;
}

export interface DeduplicationStats {
  processed: number;
  duplicates: number;
  unique: number;
  cacheSize: number;
  hitRate: number;
}

export class MessageDeduplicator extends EventEmitter {
  private redis: Redis;
  private localCache = new Map<string, DuplicateInfo>();
  private stats: DeduplicationStats = {
    processed: 0,
    duplicates: 0,
    unique: 0,
    cacheSize: 0,
    hitRate: 0
  };
  private config: Required<DeduplicationConfig>;

  constructor(config: DeduplicationConfig = {}) {
    super();
    this.config = {
      windowSize: config.windowSize || 60000, // 1 minute default
      ttl: config.ttl || 300, // 5 minutes default
      hashFunction: config.hashFunction || this.defaultHashFunction,
      redis: config.redis || new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        keyPrefix: 'ms5:dedup:',
        enableReadyCheck: true
      }),
      enableMetrics: config.enableMetrics ?? true,
      maxCacheSize: config.maxCacheSize || 10000
    };

    this.redis = this.config.redis;
    this.startCleanup();
    
    if (this.config.enableMetrics) {
      this.startMetricsReporting();
    }
  }

  private defaultHashFunction(message: any): string {
    const content = typeof message === 'string' 
      ? message 
      : JSON.stringify(this.normalizeObject(message));
    
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private normalizeObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Remove timestamp fields for deduplication
    const normalized = { ...obj };
    delete normalized.timestamp;
    delete normalized.createdAt;
    delete normalized.updatedAt;
    delete normalized.receivedAt;
    delete normalized._id;
    delete normalized.id;

    // Sort object keys for consistent hashing
    const sorted: any = {};
    Object.keys(normalized).sort().forEach(key => {
      sorted[key] = typeof normalized[key] === 'object' 
        ? this.normalizeObject(normalized[key])
        : normalized[key];
    });

    return sorted;
  }

  async isDuplicate(
    message: any,
    options: {
      messageId?: string;
      metadata?: Record<string, any>;
      ttl?: number;
    } = {}
  ): Promise<boolean> {
    this.stats.processed++;

    const hash = this.config.hashFunction(message);
    const messageId = options.messageId || hash;
    const ttl = options.ttl || this.config.ttl;

    // Check local cache first
    const localEntry = this.localCache.get(hash);
    if (localEntry) {
      const age = Date.now() - localEntry.firstSeen.getTime();
      if (age < this.config.windowSize) {
        this.handleDuplicate(localEntry, messageId, options.metadata);
        return true;
      }
    }

    // Check Redis
    try {
      const redisKey = `msg:${hash}`;
      const existing = await this.redis.get(redisKey);

      if (existing) {
        const info: DuplicateInfo = JSON.parse(existing);
        info.lastSeen = new Date();
        info.count++;
        
        // Update Redis
        await this.redis.setex(redisKey, ttl, JSON.stringify(info));
        
        // Update local cache
        this.updateLocalCache(hash, info);
        
        this.handleDuplicate(info, messageId, options.metadata);
        return true;
      }

      // New unique message
      const info: DuplicateInfo = {
        messageId,
        hash,
        firstSeen: new Date(),
        lastSeen: new Date(),
        count: 1,
        metadata: options.metadata
      };

      // Store in Redis
      await this.redis.setex(redisKey, ttl, JSON.stringify(info));
      
      // Store in local cache
      this.updateLocalCache(hash, info);
      
      this.stats.unique++;
      this.emit('unique', { messageId, hash, metadata: options.metadata });
      
      return false;
    } catch (error) {
      logger.error({ error, hash }, 'Deduplication check error');
      // On error, assume not duplicate to avoid data loss
      return false;
    }
  }

  private handleDuplicate(
    info: DuplicateInfo,
    messageId: string,
    metadata?: Record<string, any>
  ): void {
    this.stats.duplicates++;
    
    logger.debug({
      messageId,
      originalId: info.messageId,
      hash: info.hash,
      count: info.count,
      timeSinceFirst: Date.now() - new Date(info.firstSeen).getTime()
    }, 'Duplicate message detected');

    this.emit('duplicate', {
      messageId,
      originalId: info.messageId,
      hash: info.hash,
      count: info.count,
      metadata
    });
  }

  private updateLocalCache(hash: string, info: DuplicateInfo): void {
    // Implement LRU eviction
    if (this.localCache.size >= this.config.maxCacheSize) {
      const oldestKey = this.localCache.keys().next().value;
      this.localCache.delete(oldestKey);
    }

    this.localCache.set(hash, info);
    this.stats.cacheSize = this.localCache.size;
  }

  async processMessage<T>(
    message: any,
    handler: (message: any) => Promise<T>,
    options: {
      messageId?: string;
      metadata?: Record<string, any>;
      onDuplicate?: (info: any) => void;
    } = {}
  ): Promise<T | null> {
    const isDup = await this.isDuplicate(message, options);

    if (isDup) {
      if (options.onDuplicate) {
        options.onDuplicate({ messageId: options.messageId, message });
      }
      return null;
    }

    return handler(message);
  }

  async processBatch(
    messages: any[],
    options: {
      parallel?: boolean;
      ttl?: number;
    } = {}
  ): Promise<{ unique: any[]; duplicates: any[] }> {
    const unique: any[] = [];
    const duplicates: any[] = [];

    const processOne = async (message: any) => {
      const isDup = await this.isDuplicate(message, { ttl: options.ttl });
      if (isDup) {
        duplicates.push(message);
      } else {
        unique.push(message);
      }
    };

    if (options.parallel) {
      await Promise.all(messages.map(processOne));
    } else {
      for (const message of messages) {
        await processOne(message);
      }
    }

    return { unique, duplicates };
  }

  private startCleanup(): void {
    // Clean up old entries from local cache
    setInterval(() => {
      const now = Date.now();
      const expired: string[] = [];

      for (const [hash, info] of this.localCache.entries()) {
        const age = now - info.firstSeen.getTime();
        if (age > this.config.windowSize * 2) {
          expired.push(hash);
        }
      }

      for (const hash of expired) {
        this.localCache.delete(hash);
      }

      if (expired.length > 0) {
        logger.debug({ count: expired.length }, 'Cleaned expired cache entries');
      }
    }, 60000); // Every minute
  }

  private startMetricsReporting(): void {
    setInterval(() => {
      const total = this.stats.processed;
      if (total > 0) {
        this.stats.hitRate = this.stats.duplicates / total;
        
        logger.info({
          ...this.stats,
          hitRatePercent: (this.stats.hitRate * 100).toFixed(2) + '%'
        }, 'Deduplication metrics');

        this.emit('metrics', this.stats);
      }
    }, 30000); // Every 30 seconds
  }

  async clear(pattern?: string): Promise<number> {
    let cleared = 0;

    if (pattern) {
      // Clear specific pattern
      const keys = await this.redis.keys(`msg:*${pattern}*`);
      if (keys.length > 0) {
        cleared = await this.redis.del(...keys);
      }

      // Clear from local cache
      for (const [hash, info] of this.localCache.entries()) {
        if (info.messageId.includes(pattern) || hash.includes(pattern)) {
          this.localCache.delete(hash);
          cleared++;
        }
      }
    } else {
      // Clear all
      const keys = await this.redis.keys('msg:*');
      if (keys.length > 0) {
        cleared = await this.redis.del(...keys);
      }
      
      cleared += this.localCache.size;
      this.localCache.clear();
    }

    logger.info({ pattern, cleared }, 'Deduplication cache cleared');
    return cleared;
  }

  getStats(): DeduplicationStats {
    return { ...this.stats };
  }

  async shutdown(): Promise<void> {
    await this.redis.quit();
    this.localCache.clear();
    this.removeAllListeners();
    logger.info('Message deduplicator shut down');
  }
}

// Specialized deduplicators for different message types
export class TelemetryDeduplicator extends MessageDeduplicator {
  constructor() {
    super({
      windowSize: 5000, // 5 seconds for telemetry
      ttl: 60, // 1 minute TTL
      hashFunction: (message) => {
        // Hash based on sensor ID and value
        const key = `${message.sensorId}:${message.value}:${Math.floor(message.timestamp / 1000)}`;
        return crypto.createHash('md5').update(key).digest('hex');
      }
    });
  }
}

export class EventDeduplicator extends MessageDeduplicator {
  constructor() {
    super({
      windowSize: 60000, // 1 minute for events
      ttl: 300, // 5 minutes TTL
      hashFunction: (message) => {
        // Hash based on event type and key fields
        const key = `${message.type}:${message.source}:${message.target}:${message.action}`;
        return crypto.createHash('sha256').update(key).digest('hex');
      }
    });
  }
}

export class AlertDeduplicator extends MessageDeduplicator {
  constructor() {
    super({
      windowSize: 300000, // 5 minutes for alerts
      ttl: 3600, // 1 hour TTL
      hashFunction: (message) => {
        // Hash based on alert key fields
        const key = `${message.type}:${message.severity}:${message.source}:${message.condition}`;
        return crypto.createHash('sha256').update(key).digest('hex');
      }
    });
  }
}

// Factory function
export function createDeduplicator(type: 'telemetry' | 'event' | 'alert' | 'general'): MessageDeduplicator {
  switch (type) {
    case 'telemetry':
      return new TelemetryDeduplicator();
    case 'event':
      return new EventDeduplicator();
    case 'alert':
      return new AlertDeduplicator();
    default:
      return new MessageDeduplicator();
  }
}