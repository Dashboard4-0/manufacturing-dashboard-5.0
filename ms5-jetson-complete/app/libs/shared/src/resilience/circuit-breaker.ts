import { EventEmitter } from 'events';
import { createLogger } from '../logger';

const logger = createLogger('circuit-breaker');

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  volumeThreshold?: number;
  errorThresholdPercentage?: number;
  fallback?: (...args: any[]) => Promise<any>;
  isFailure?: (error: any) => boolean;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  requests: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttempt?: Date;
  errorRate: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private requests = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private requestCounts: number[] = [];
  private errorCounts: number[] = [];
  private windowStart = Date.now();
  private config: Required<CircuitBreakerConfig>;

  constructor(
    private name: string,
    config: CircuitBreakerConfig = {}
  ) {
    super();
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 3000,
      resetTimeout: config.resetTimeout || 60000,
      volumeThreshold: config.volumeThreshold || 10,
      errorThresholdPercentage: config.errorThresholdPercentage || 50,
      fallback: config.fallback || this.defaultFallback,
      isFailure: config.isFailure || this.defaultIsFailure
    };

    this.startMetricsCollection();
  }

  private defaultFallback(): Promise<any> {
    return Promise.reject(new Error(`Circuit breaker ${this.name} is OPEN`));
  }

  private defaultIsFailure(error: any): boolean {
    // Consider timeouts and 5xx errors as failures
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      return true;
    }
    if (error.response && error.response.status >= 500) {
      return true;
    }
    return false;
  }

  async execute<T>(
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    // Check if circuit should be opened based on error rate
    this.checkErrorThreshold();

    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.halfOpen();
      } else {
        this.emit('rejected', { name: this.name, state: this.state });
        return this.config.fallback(...args);
      }
    }

    return this.callWithTimeout(fn, ...args);
  }

  private async callWithTimeout<T>(
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });

    try {
      this.requests++;
      const result = await Promise.race([fn(...args), timeoutPromise]);
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.config.isFailure(error)) {
        this.onFailure(error);
      } else {
        // Not considered a failure, but still record
        this.onSuccess();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccessTime = new Date();
    this.failures = 0; // Reset consecutive failures

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.config.successThreshold) {
        this.close();
      }
    }

    this.emit('success', {
      name: this.name,
      state: this.state,
      successes: this.successes
    });
  }

  private onFailure(error: any): void {
    this.failures++;
    this.lastFailureTime = new Date();
    this.successes = 0; // Reset consecutive successes

    logger.warn({
      circuit: this.name,
      state: this.state,
      failures: this.failures,
      error: error.message
    }, 'Circuit breaker failure');

    if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failures >= this.config.failureThreshold) {
        this.open();
      }
    }

    this.emit('failure', {
      name: this.name,
      state: this.state,
      failures: this.failures,
      error
    });
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) return true;
    return Date.now() >= this.nextAttemptTime.getTime();
  }

  private checkErrorThreshold(): void {
    const now = Date.now();
    const windowDuration = 60000; // 1 minute rolling window

    // Clean old data
    if (now - this.windowStart > windowDuration) {
      this.requestCounts.shift();
      this.errorCounts.shift();
      this.windowStart = now - windowDuration;
    }

    const totalRequests = this.requestCounts.reduce((sum, count) => sum + count, 0);
    const totalErrors = this.errorCounts.reduce((sum, count) => sum + count, 0);

    if (totalRequests >= this.config.volumeThreshold) {
      const errorRate = (totalErrors / totalRequests) * 100;
      if (errorRate >= this.config.errorThresholdPercentage && this.state === CircuitState.CLOSED) {
        logger.warn({
          circuit: this.name,
          errorRate,
          threshold: this.config.errorThresholdPercentage,
          totalRequests,
          totalErrors
        }, 'Error threshold exceeded, opening circuit');
        this.open();
      }
    }
  }

  private open(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
    
    logger.info({
      circuit: this.name,
      nextAttempt: this.nextAttemptTime
    }, 'Circuit breaker opened');

    this.emit('open', {
      name: this.name,
      failures: this.failures,
      nextAttempt: this.nextAttemptTime
    });
  }

  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successes = 0;
    this.failures = 0;
    
    logger.info({ circuit: this.name }, 'Circuit breaker half-open');

    this.emit('half-open', { name: this.name });
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.nextAttemptTime = undefined;
    
    logger.info({ circuit: this.name }, 'Circuit breaker closed');

    this.emit('close', { name: this.name });
  }

  private startMetricsCollection(): void {
    // Collect metrics every second
    setInterval(() => {
      const second = Math.floor(Date.now() / 1000);
      const index = second % 60;

      if (!this.requestCounts[index]) {
        this.requestCounts[index] = 0;
        this.errorCounts[index] = 0;
      }

      // This will be updated by actual requests
    }, 1000);
  }

  getStats(): CircuitBreakerStats {
    const totalRequests = this.requestCounts.reduce((sum, count) => sum + count, 0);
    const totalErrors = this.errorCounts.reduce((sum, count) => sum + count, 0);
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) : 0;

    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttempt: this.nextAttemptTime,
      errorRate
    };
  }

  reset(): void {
    this.close();
    this.failures = 0;
    this.successes = 0;
    this.requests = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    
    logger.info({ circuit: this.name }, 'Circuit breaker manually reset');
  }
}

// Circuit breaker factory with registry
export class CircuitBreakerRegistry {
  private static instance: CircuitBreakerRegistry;
  private breakers = new Map<string, CircuitBreaker>();

  private constructor() {}

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  create(name: string, config?: CircuitBreakerConfig): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const breaker = new CircuitBreaker(name, config);
    this.breakers.set(name, breaker);
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getStats(): Map<string, CircuitBreakerStats> {
    const stats = new Map<string, CircuitBreakerStats>();
    for (const [name, breaker] of this.breakers) {
      stats.set(name, breaker.getStats());
    }
    return stats;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  remove(name: string): boolean {
    return this.breakers.delete(name);
  }

  clear(): void {
    this.breakers.clear();
  }
}

// Decorator for circuit breaker protection
export function CircuitProtected(
  name: string,
  config?: CircuitBreakerConfig
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const registry = CircuitBreakerRegistry.getInstance();

    descriptor.value = async function (...args: any[]) {
      const breaker = registry.create(
        `${name}.${propertyKey}`,
        config
      );

      return breaker.execute(
        () => originalMethod.apply(this, args),
        ...args
      );
    };

    return descriptor;
  };
}

// Specialized circuit breakers
export class DatabaseCircuitBreaker extends CircuitBreaker {
  constructor(name: string) {
    super(name, {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      resetTimeout: 30000,
      errorThresholdPercentage: 30,
      isFailure: (error) => {
        // Database-specific failure detection
        return error.code === 'ECONNREFUSED' ||
               error.code === 'ETIMEDOUT' ||
               error.code === 'ENOTFOUND' ||
               error.message?.includes('connection') ||
               error.message?.includes('timeout');
      }
    });
  }
}

export class APICircuitBreaker extends CircuitBreaker {
  constructor(name: string) {
    super(name, {
      failureThreshold: 5,
      successThreshold: 3,
      timeout: 10000,
      resetTimeout: 60000,
      errorThresholdPercentage: 50,
      isFailure: (error) => {
        // API-specific failure detection
        if (error.response) {
          return error.response.status >= 500 || error.response.status === 429;
        }
        return error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT';
      }
    });
  }
}

export class MessageQueueCircuitBreaker extends CircuitBreaker {
  constructor(name: string) {
    super(name, {
      failureThreshold: 10,
      successThreshold: 5,
      timeout: 15000,
      resetTimeout: 120000,
      errorThresholdPercentage: 40,
      isFailure: (error) => {
        // Message queue-specific failure detection
        return error.code === 'ECONNREFUSED' ||
               error.code === 'ETIMEDOUT' ||
               error.message?.includes('broker') ||
               error.message?.includes('queue');
      }
    });
  }
}