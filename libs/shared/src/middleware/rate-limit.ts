import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { createLogger } from '../logger';
import crypto from 'crypto';

const logger = createLogger('rate-limiter');

export interface RateLimitConfig {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  handler?: (req: Request, res: Response) => void;
  redis?: Redis;
  enableUserLimits?: boolean;
  enableIpLimits?: boolean;
  enableEndpointLimits?: boolean;
  userLimits?: Map<string, { windowMs: number; maxRequests: number }>;
  endpointLimits?: Map<string, { windowMs: number; maxRequests: number }>;
}

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetAt: Date;
}

export class RateLimiter {
  private redis: Redis;
  private config: Required<RateLimitConfig>;
  private userLimits: Map<string, { windowMs: number; maxRequests: number }>;
  private endpointLimits: Map<string, { windowMs: number; maxRequests: number }>;

  constructor(config: RateLimitConfig = {}) {
    this.config = {
      windowMs: config.windowMs || 60000, // 1 minute default
      maxRequests: config.maxRequests || 100,
      keyGenerator: config.keyGenerator || this.defaultKeyGenerator,
      skipSuccessfulRequests: config.skipSuccessfulRequests || false,
      skipFailedRequests: config.skipFailedRequests || false,
      handler: config.handler || this.defaultHandler,
      redis: config.redis || new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        keyPrefix: 'ms5:ratelimit:',
        enableReadyCheck: true
      }),
      enableUserLimits: config.enableUserLimits ?? true,
      enableIpLimits: config.enableIpLimits ?? true,
      enableEndpointLimits: config.enableEndpointLimits ?? true,
      userLimits: config.userLimits || new Map(),
      endpointLimits: config.endpointLimits || new Map()
    };

    this.redis = this.config.redis;
    this.userLimits = this.config.userLimits;
    this.endpointLimits = this.config.endpointLimits;

    this.setupDefaultLimits();
  }

  private setupDefaultLimits(): void {
    // Setup user-specific limits (e.g., different tiers)
    this.userLimits.set('premium', { windowMs: 60000, maxRequests: 1000 });
    this.userLimits.set('standard', { windowMs: 60000, maxRequests: 100 });
    this.userLimits.set('basic', { windowMs: 60000, maxRequests: 50 });

    // Setup endpoint-specific limits
    this.endpointLimits.set('/api/graphql', { windowMs: 60000, maxRequests: 200 });
    this.endpointLimits.set('/api/telemetry', { windowMs: 1000, maxRequests: 100 }); // High frequency endpoint
    this.endpointLimits.set('/api/reports', { windowMs: 60000, maxRequests: 10 }); // Resource intensive
    this.endpointLimits.set('/api/auth/login', { windowMs: 300000, maxRequests: 5 }); // Prevent brute force
    this.endpointLimits.set('/api/export', { windowMs: 60000, maxRequests: 5 });
  }

  private defaultKeyGenerator(req: Request): string {
    const parts: string[] = [];

    // Add user ID if available
    if (req.user && this.config.enableUserLimits) {
      parts.push(`user:${req.user.id}`);
    }

    // Add IP address
    if (this.config.enableIpLimits) {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      parts.push(`ip:${ip}`);
    }

    // Add endpoint
    if (this.config.enableEndpointLimits) {
      parts.push(`endpoint:${req.method}:${req.path}`);
    }

    return parts.join(':') || 'global';
  }

  private defaultHandler(req: Request, res: Response): void {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: res.getHeader('Retry-After')
    });
  }

  private getLimitsForRequest(req: Request): { windowMs: number; maxRequests: number } {
    // Check endpoint-specific limits
    const endpoint = `${req.method}:${req.path}`;
    const endpointLimit = this.endpointLimits.get(req.path) || 
                         this.endpointLimits.get(endpoint);
    if (endpointLimit) {
      return endpointLimit;
    }

    // Check user-specific limits
    if (req.user) {
      const userTier = (req.user as any).tier || 'standard';
      const userLimit = this.userLimits.get(userTier);
      if (userLimit) {
        return userLimit;
      }
    }

    // Return default limits
    return {
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests
    };
  }

  async checkLimit(key: string, limits: { windowMs: number; maxRequests: number }): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = now - limits.windowMs;
    const redisKey = `${key}:${Math.floor(now / limits.windowMs)}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.expire(redisKey, Math.ceil(limits.windowMs / 1000));
      
      const results = await pipeline.exec();
      const current = results?.[0]?.[1] as number || 1;

      const remaining = Math.max(0, limits.maxRequests - current);
      const resetAt = new Date(Math.ceil(now / limits.windowMs) * limits.windowMs + limits.windowMs);

      return {
        limit: limits.maxRequests,
        current,
        remaining,
        resetAt
      };
    } catch (error) {
      logger.error({ error, key }, 'Rate limit check error');
      // On error, allow the request
      return {
        limit: limits.maxRequests,
        current: 0,
        remaining: limits.maxRequests,
        resetAt: new Date(now + limits.windowMs)
      };
    }
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.keyGenerator(req);
      const limits = this.getLimitsForRequest(req);

      const limitInfo = await this.checkLimit(key, limits);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limitInfo.limit);
      res.setHeader('X-RateLimit-Remaining', limitInfo.remaining);
      res.setHeader('X-RateLimit-Reset', limitInfo.resetAt.toISOString());

      if (limitInfo.remaining <= 0) {
        res.setHeader('Retry-After', Math.ceil((limitInfo.resetAt.getTime() - Date.now()) / 1000));
        
        logger.warn({
          key,
          limit: limitInfo.limit,
          current: limitInfo.current,
          ip: req.ip,
          user: req.user?.id,
          path: req.path
        }, 'Rate limit exceeded');

        return this.config.handler(req, res);
      }

      // Track response status for conditional counting
      if (this.config.skipSuccessfulRequests || this.config.skipFailedRequests) {
        const originalSend = res.send;
        res.send = function(data) {
          const shouldSkip = 
            (res.statusCode < 400 && this.config.skipSuccessfulRequests) ||
            (res.statusCode >= 400 && this.config.skipFailedRequests);
          
          if (shouldSkip) {
            // Decrement the counter
            this.redis.decr(`${key}:${Math.floor(Date.now() / limits.windowMs)}`);
          }

          return originalSend.call(this, data);
        }.bind(this);
      }

      next();
    };
  }

  async reset(key: string): Promise<void> {
    const pattern = `${key}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    logger.info({ key, count: keys.length }, 'Rate limit reset');
  }

  async getUserStatus(userId: string): Promise<Map<string, RateLimitInfo>> {
    const status = new Map<string, RateLimitInfo>();
    const patterns = [
      `user:${userId}:*`,
      `*:user:${userId}:*`
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      for (const key of keys) {
        const value = await this.redis.get(key);
        const ttl = await this.redis.ttl(key);
        
        if (value && ttl > 0) {
          const limits = this.getLimitsForUser(userId);
          status.set(key, {
            limit: limits.maxRequests,
            current: parseInt(value),
            remaining: Math.max(0, limits.maxRequests - parseInt(value)),
            resetAt: new Date(Date.now() + ttl * 1000)
          });
        }
      }
    }

    return status;
  }

  private getLimitsForUser(userId: string): { windowMs: number; maxRequests: number } {
    // This would typically fetch from database
    // For now, return standard limits
    return this.userLimits.get('standard') || {
      windowMs: this.config.windowMs,
      maxRequests: this.config.maxRequests
    };
  }

  updateUserLimits(userId: string, tier: string): void {
    const limits = this.userLimits.get(tier);
    if (limits) {
      // Store in cache for quick access
      this.redis.setex(
        `user:limits:${userId}`,
        86400, // 24 hours
        JSON.stringify({ tier, ...limits })
      );
    }
  }
}

// Factory functions for different rate limiting strategies
export function createGeneralRateLimiter(): RateLimiter {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests: 100
  });
}

export function createStrictRateLimiter(): RateLimiter {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests: 20,
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  });
}

export function createApiRateLimiter(): RateLimiter {
  return new RateLimiter({
    windowMs: 60000,
    maxRequests: 1000,
    enableUserLimits: true,
    enableEndpointLimits: true,
    skipSuccessfulRequests: false,
    skipFailedRequests: true // Don't count failed requests
  });
}

// Sliding window rate limiter for more accurate limiting
export class SlidingWindowRateLimiter extends RateLimiter {
  async checkLimit(key: string, limits: { windowMs: number; maxRequests: number }): Promise<RateLimitInfo> {
    const now = Date.now();
    const windowStart = now - limits.windowMs;

    try {
      const pipeline = this.redis.pipeline();
      
      // Remove old entries
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      
      // Add current request
      pipeline.zadd(key, now, `${now}:${crypto.randomBytes(4).toString('hex')}`);
      
      // Count requests in window
      pipeline.zcount(key, windowStart, now);
      
      // Set expiry
      pipeline.expire(key, Math.ceil(limits.windowMs / 1000));
      
      const results = await pipeline.exec();
      const count = results?.[2]?.[1] as number || 1;

      const remaining = Math.max(0, limits.maxRequests - count);
      const oldestEntry = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      const resetAt = oldestEntry && oldestEntry.length > 1
        ? new Date(parseInt(oldestEntry[1]) + limits.windowMs)
        : new Date(now + limits.windowMs);

      return {
        limit: limits.maxRequests,
        current: count,
        remaining,
        resetAt
      };
    } catch (error) {
      logger.error({ error, key }, 'Sliding window rate limit error');
      return {
        limit: limits.maxRequests,
        current: 0,
        remaining: limits.maxRequests,
        resetAt: new Date(now + limits.windowMs)
      };
    }
  }
}

// Distributed rate limiter for multi-instance deployments
export class DistributedRateLimiter extends RateLimiter {
  private instanceId: string;

  constructor(config: RateLimitConfig = {}) {
    super(config);
    this.instanceId = process.env.INSTANCE_ID || crypto.randomBytes(8).toString('hex');
  }

  async checkLimit(key: string, limits: { windowMs: number; maxRequests: number }): Promise<RateLimitInfo> {
    const now = Date.now();
    const redisKey = `distributed:${key}`;

    try {
      // Use Lua script for atomic operation across instances
      const script = `
        local key = KEYS[1]
        local window = tonumber(ARGV[1])
        local max_requests = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local window_start = now - window
        
        -- Clean old entries
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        
        -- Count current requests
        local current = redis.call('ZCARD', key)
        
        if current < max_requests then
          -- Add new request
          redis.call('ZADD', key, now, now .. ':' .. ARGV[4])
          redis.call('EXPIRE', key, window / 1000)
          current = current + 1
        end
        
        return current
      `;

      const current = await this.redis.eval(
        script,
        1,
        redisKey,
        limits.windowMs,
        limits.maxRequests,
        now,
        this.instanceId
      ) as number;

      return {
        limit: limits.maxRequests,
        current,
        remaining: Math.max(0, limits.maxRequests - current),
        resetAt: new Date(now + limits.windowMs)
      };
    } catch (error) {
      logger.error({ error, key }, 'Distributed rate limit error');
      return {
        limit: limits.maxRequests,
        current: 0,
        remaining: limits.maxRequests,
        resetAt: new Date(now + limits.windowMs)
      };
    }
  }
}