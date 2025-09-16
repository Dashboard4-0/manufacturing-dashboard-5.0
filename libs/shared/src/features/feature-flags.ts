import { Redis } from 'ioredis';
import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import crypto from 'crypto';

const logger = createLogger('feature-flags');

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
  rolloutPercentage?: number;
  targetingRules?: TargetingRule[];
  variants?: Variant[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface TargetingRule {
  attribute: string;
  operator: 'equals' | 'contains' | 'in' | 'gt' | 'lt' | 'regex';
  value: any;
  negate?: boolean;
}

export interface Variant {
  key: string;
  value: any;
  weight: number;
  overrides?: Array<{ userId: string; value: any }>;
}

export interface EvaluationContext {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  tenantId?: string;
  environment?: string;
  attributes?: Record<string, any>;
}

export interface EvaluationResult {
  enabled: boolean;
  variant?: string;
  value?: any;
  reason: string;
  metadata?: Record<string, any>;
}

export class FeatureFlagManager extends EventEmitter {
  private redis: Redis;
  private cache = new Map<string, FeatureFlag>();
  private evaluationCache = new Map<string, { result: EvaluationResult; timestamp: number }>();
  private config = {
    cacheTimeout: 60000, // 1 minute
    evaluationCacheTTL: 5000, // 5 seconds
    refreshInterval: 30000 // 30 seconds
  };
  private refreshTimer?: NodeJS.Timer;

  constructor(
    redis?: Redis,
    private options: {
      defaultFlags?: FeatureFlag[];
      enableCache?: boolean;
      autoRefresh?: boolean;
    } = {}
  ) {
    super();
    this.redis = redis || new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: 'ms5:features:',
      enableReadyCheck: true
    });

    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Load default flags
    if (this.options.defaultFlags) {
      for (const flag of this.options.defaultFlags) {
        await this.createFlag(flag);
      }
    }

    // Load all flags from Redis
    await this.loadFlags();

    // Start auto-refresh if enabled
    if (this.options.autoRefresh !== false) {
      this.startAutoRefresh();
    }

    // Subscribe to flag changes
    this.subscribeToChanges();
  }

  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(
      () => this.loadFlags(),
      this.config.refreshInterval
    );
  }

  private async loadFlags(): Promise<void> {
    try {
      const keys = await this.redis.keys('flag:*');
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const flag = JSON.parse(data) as FeatureFlag;
          this.cache.set(flag.key, flag);
        }
      }

      logger.debug({ count: this.cache.size }, 'Feature flags loaded');
    } catch (error) {
      logger.error({ error }, 'Failed to load feature flags');
    }
  }

  private subscribeToChanges(): void {
    // Create a separate Redis client for subscriptions
    const subscriber = this.redis.duplicate();
    
    subscriber.subscribe('feature:changes');
    subscriber.on('message', (channel, message) => {
      try {
        const change = JSON.parse(message);
        this.handleFlagChange(change);
      } catch (error) {
        logger.error({ error, message }, 'Failed to process flag change');
      }
    });
  }

  private handleFlagChange(change: { type: string; flag: FeatureFlag }): void {
    switch (change.type) {
      case 'created':
      case 'updated':
        this.cache.set(change.flag.key, change.flag);
        this.evaluationCache.clear(); // Clear evaluation cache
        this.emit('flag:updated', change.flag);
        break;
      case 'deleted':
        this.cache.delete(change.flag.key);
        this.evaluationCache.clear();
        this.emit('flag:deleted', change.flag.key);
        break;
    }
  }

  async createFlag(flag: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const fullFlag: FeatureFlag = {
      key: flag.key!,
      enabled: flag.enabled ?? false,
      description: flag.description,
      rolloutPercentage: flag.rolloutPercentage,
      targetingRules: flag.targetingRules || [],
      variants: flag.variants || [],
      metadata: flag.metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: flag.expiresAt
    };

    await this.redis.set(
      `flag:${fullFlag.key}`,
      JSON.stringify(fullFlag)
    );

    // Publish change
    await this.redis.publish(
      'feature:changes',
      JSON.stringify({ type: 'created', flag: fullFlag })
    );

    this.cache.set(fullFlag.key, fullFlag);
    logger.info({ key: fullFlag.key }, 'Feature flag created');

    return fullFlag;
  }

  async updateFlag(
    key: string,
    updates: Partial<FeatureFlag>
  ): Promise<FeatureFlag | null> {
    const existing = await this.getFlag(key);
    if (!existing) return null;

    const updated: FeatureFlag = {
      ...existing,
      ...updates,
      key, // Ensure key doesn't change
      updatedAt: new Date()
    };

    await this.redis.set(
      `flag:${key}`,
      JSON.stringify(updated)
    );

    // Publish change
    await this.redis.publish(
      'feature:changes',
      JSON.stringify({ type: 'updated', flag: updated })
    );

    this.cache.set(key, updated);
    logger.info({ key }, 'Feature flag updated');

    return updated;
  }

  async deleteFlag(key: string): Promise<boolean> {
    const deleted = await this.redis.del(`flag:${key}`);
    
    if (deleted) {
      // Publish change
      await this.redis.publish(
        'feature:changes',
        JSON.stringify({ type: 'deleted', flag: { key } })
      );

      this.cache.delete(key);
      logger.info({ key }, 'Feature flag deleted');
    }

    return deleted > 0;
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Load from Redis
    const data = await this.redis.get(`flag:${key}`);
    if (!data) return null;

    const flag = JSON.parse(data) as FeatureFlag;
    this.cache.set(key, flag);

    return flag;
  }

  async evaluate(
    key: string,
    context: EvaluationContext = {}
  ): Promise<EvaluationResult> {
    // Check evaluation cache
    const cacheKey = `${key}:${JSON.stringify(context)}`;
    const cached = this.evaluationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.config.evaluationCacheTTL) {
      return cached.result;
    }

    const flag = await this.getFlag(key);
    
    if (!flag) {
      return {
        enabled: false,
        reason: 'Flag not found'
      };
    }

    // Check expiration
    if (flag.expiresAt && new Date(flag.expiresAt) < new Date()) {
      return {
        enabled: false,
        reason: 'Flag expired'
      };
    }

    // Check if globally disabled
    if (!flag.enabled) {
      return {
        enabled: false,
        reason: 'Flag disabled'
      };
    }

    // Evaluate targeting rules
    const targetingResult = this.evaluateTargeting(flag, context);
    if (targetingResult !== null) {
      return targetingResult;
    }

    // Evaluate percentage rollout
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const enabled = this.evaluateRollout(key, context, flag.rolloutPercentage);
      const result: EvaluationResult = {
        enabled,
        reason: enabled ? 'In rollout group' : 'Not in rollout group'
      };

      // Cache the result
      this.evaluationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    }

    // Evaluate variants
    if (flag.variants && flag.variants.length > 0) {
      const variant = this.selectVariant(flag.variants, context);
      const result: EvaluationResult = {
        enabled: true,
        variant: variant.key,
        value: variant.value,
        reason: 'Variant selected'
      };

      // Cache the result
      this.evaluationCache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    }

    // Default to enabled
    const result: EvaluationResult = {
      enabled: true,
      reason: 'Default enabled'
    };

    // Cache the result
    this.evaluationCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    return result;
  }

  private evaluateTargeting(
    flag: FeatureFlag,
    context: EvaluationContext
  ): EvaluationResult | null {
    if (!flag.targetingRules || flag.targetingRules.length === 0) {
      return null;
    }

    for (const rule of flag.targetingRules) {
      const value = this.getContextValue(context, rule.attribute);
      const matches = this.evaluateRule(rule, value);

      if (matches) {
        return {
          enabled: !rule.negate,
          reason: `Targeting rule matched: ${rule.attribute} ${rule.operator} ${rule.value}`
        };
      }
    }

    return null;
  }

  private getContextValue(context: EvaluationContext, path: string): any {
    const parts = path.split('.');
    let value: any = context;

    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }

    return value;
  }

  private evaluateRule(rule: TargetingRule, value: any): boolean {
    switch (rule.operator) {
      case 'equals':
        return value === rule.value;
      case 'contains':
        return String(value).includes(String(rule.value));
      case 'in':
        return Array.isArray(rule.value) && rule.value.includes(value);
      case 'gt':
        return Number(value) > Number(rule.value);
      case 'lt':
        return Number(value) < Number(rule.value);
      case 'regex':
        return new RegExp(rule.value).test(String(value));
      default:
        return false;
    }
  }

  private evaluateRollout(
    key: string,
    context: EvaluationContext,
    percentage: number
  ): boolean {
    const identifier = context.userId || context.tenantId || 'anonymous';
    const hash = crypto
      .createHash('md5')
      .update(`${key}:${identifier}`)
      .digest('hex');
    
    const hashValue = parseInt(hash.substring(0, 8), 16);
    const bucket = (hashValue % 100) + 1;
    
    return bucket <= percentage;
  }

  private selectVariant(
    variants: Variant[],
    context: EvaluationContext
  ): Variant {
    // Check for user overrides
    if (context.userId) {
      for (const variant of variants) {
        if (variant.overrides) {
          const override = variant.overrides.find(
            o => o.userId === context.userId
          );
          if (override) {
            return { ...variant, value: override.value };
          }
        }
      }
    }

    // Weighted random selection
    const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
    const random = Math.random() * totalWeight;
    
    let accumulator = 0;
    for (const variant of variants) {
      accumulator += variant.weight;
      if (random <= accumulator) {
        return variant;
      }
    }

    return variants[0]; // Fallback
  }

  async isEnabled(
    key: string,
    context?: EvaluationContext
  ): Promise<boolean> {
    const result = await this.evaluate(key, context);
    return result.enabled;
  }

  async getVariant(
    key: string,
    context?: EvaluationContext
  ): Promise<string | undefined> {
    const result = await this.evaluate(key, context);
    return result.variant;
  }

  async getValue(
    key: string,
    defaultValue: any,
    context?: EvaluationContext
  ): Promise<any> {
    const result = await this.evaluate(key, context);
    return result.value !== undefined ? result.value : defaultValue;
  }

  getAllFlags(): FeatureFlag[] {
    return Array.from(this.cache.values());
  }

  async bulkEvaluate(
    context: EvaluationContext
  ): Promise<Record<string, EvaluationResult>> {
    const results: Record<string, EvaluationResult> = {};
    
    for (const flag of this.cache.values()) {
      results[flag.key] = await this.evaluate(flag.key, context);
    }

    return results;
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    await this.redis.quit();
    this.removeAllListeners();
    logger.info('Feature flag manager shut down');
  }
}

// Predefined feature flags
export const DEFAULT_FLAGS: FeatureFlag[] = [
  {
    key: 'new-dashboard',
    enabled: true,
    description: 'Enable new dashboard UI',
    rolloutPercentage: 100,
    targetingRules: [],
    variants: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    key: 'advanced-analytics',
    enabled: true,
    description: 'Enable advanced analytics features',
    rolloutPercentage: 50,
    targetingRules: [
      {
        attribute: 'userRole',
        operator: 'in',
        value: ['admin', 'analyst']
      }
    ],
    variants: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    key: 'experimental-ml',
    enabled: false,
    description: 'Enable experimental ML features',
    targetingRules: [
      {
        attribute: 'environment',
        operator: 'equals',
        value: 'development'
      }
    ],
    variants: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

// Singleton instance
let flagManager: FeatureFlagManager | null = null;

export function initializeFeatureFlags(
  redis?: Redis,
  options?: any
): FeatureFlagManager {
  if (!flagManager) {
    flagManager = new FeatureFlagManager(redis, {
      ...options,
      defaultFlags: DEFAULT_FLAGS
    });
  }
  return flagManager;
}

export function getFeatureFlags(): FeatureFlagManager {
  if (!flagManager) {
    flagManager = new FeatureFlagManager(undefined, {
      defaultFlags: DEFAULT_FLAGS
    });
  }
  return flagManager;
}

// React hook for feature flags
export function useFeatureFlag(
  key: string,
  context?: EvaluationContext
): { enabled: boolean; loading: boolean; error?: Error } {
  // This would be implemented in the React app
  // Placeholder for type definition
  return { enabled: false, loading: false };
}