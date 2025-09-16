import { performance } from 'perf_hooks';
import autocannon from 'autocannon';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { Kafka } from 'kafkajs';
import { createLogger } from '@ms5/shared/logger';

const logger = createLogger('benchmark');

export interface BenchmarkConfig {
  apiUrl?: string;
  duration?: number;
  connections?: number;
  pipelining?: number;
  warmup?: number;
  scenarios?: ScenarioConfig[];
}

export interface ScenarioConfig {
  name: string;
  endpoint: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  rps?: number;
  duration?: number;
  thresholds?: {
    p95?: number;
    p99?: number;
    errorRate?: number;
  };
}

export interface BenchmarkResult {
  scenario: string;
  requests: {
    total: number;
    persec: number;
  };
  latency: {
    min: number;
    max: number;
    mean: number;
    stddev: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  throughput: {
    total: number;
    persec: number;
  };
  errors: number;
  errorRate: number;
  timeouts: number;
  duration: number;
  passed: boolean;
}

export class PerformanceBenchmark {
  private config: Required<BenchmarkConfig>;
  private results: BenchmarkResult[] = [];
  private pool?: Pool;
  private redis?: Redis;
  private kafka?: Kafka;

  constructor(config: BenchmarkConfig = {}) {
    this.config = {
      apiUrl: config.apiUrl || 'http://localhost:4000',
      duration: config.duration || 30,
      connections: config.connections || 10,
      pipelining: config.pipelining || 1,
      warmup: config.warmup || 5,
      scenarios: config.scenarios || this.getDefaultScenarios()
    };
  }

  private getDefaultScenarios(): ScenarioConfig[] {
    return [
      {
        name: 'Health Check',
        endpoint: '/health',
        method: 'GET',
        rps: 1000,
        duration: 10,
        thresholds: {
          p95: 50,
          p99: 100,
          errorRate: 0
        }
      },
      {
        name: 'GraphQL Query',
        endpoint: '/graphql',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: `
            query GetProductionLines {
              productionLines {
                id
                name
                currentOEE
              }
            }
          `
        }),
        rps: 100,
        duration: 30,
        thresholds: {
          p95: 500,
          p99: 1000,
          errorRate: 1
        }
      },
      {
        name: 'Telemetry Ingestion',
        endpoint: '/api/v2/telemetry',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assetId: 'asset-001',
          timestamp: new Date().toISOString(),
          temperature: 75.5,
          pressure: 101.3,
          vibration: 0.05
        }),
        rps: 500,
        duration: 30,
        thresholds: {
          p95: 100,
          p99: 200,
          errorRate: 0.1
        }
      },
      {
        name: 'REST API List',
        endpoint: '/api/v2/production-lines',
        method: 'GET',
        rps: 200,
        duration: 30,
        thresholds: {
          p95: 300,
          p99: 500,
          errorRate: 0.5
        }
      },
      {
        name: 'WebSocket Connection',
        endpoint: '/ws',
        method: 'GET',
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade'
        },
        rps: 50,
        duration: 10,
        thresholds: {
          p95: 1000,
          p99: 2000,
          errorRate: 1
        }
      }
    ];
  }

  async setup(): Promise<void> {
    logger.info('Setting up benchmark environment');

    // Initialize database pool
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'ms5db_test',
      user: process.env.DB_USER || 'ms5user',
      password: process.env.DB_PASSWORD,
      max: 20
    });

    // Initialize Redis
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });

    // Initialize Kafka
    this.kafka = new Kafka({
      clientId: 'benchmark',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',')
    });

    // Clear caches
    await this.redis.flushall();

    // Load test data
    await this.loadTestData();

    logger.info('Benchmark setup complete');
  }

  private async loadTestData(): Promise<void> {
    // Insert test production lines
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push({
        id: `line-${i.toString().padStart(3, '0')}`,
        name: `Production Line ${i}`,
        status: 'active'
      });
    }

    // Batch insert
    const values = lines
      .map((line, index) => 
        `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`
      )
      .join(', ');
    
    const params = lines.flatMap(line => [line.id, line.name, line.status]);

    await this.pool!.query(
      `INSERT INTO production_lines (id, name, status) VALUES ${values} ON CONFLICT DO NOTHING`,
      params
    );

    logger.info({ count: lines.length }, 'Test data loaded');
  }

  async warmup(): Promise<void> {
    logger.info({ duration: this.config.warmup }, 'Starting warmup');

    for (const scenario of this.config.scenarios) {
      await this.runWarmup(scenario);
    }

    logger.info('Warmup complete');
  }

  private async runWarmup(scenario: ScenarioConfig): Promise<void> {
    const instance = autocannon({
      url: `${this.config.apiUrl}${scenario.endpoint}`,
      method: scenario.method || 'GET',
      headers: scenario.headers,
      body: scenario.body,
      connections: 5,
      duration: this.config.warmup,
      pipelining: 1
    });

    await new Promise((resolve) => {
      instance.on('done', resolve);
    });
  }

  async runScenario(scenario: ScenarioConfig): Promise<BenchmarkResult> {
    logger.info({ scenario: scenario.name }, 'Running benchmark scenario');

    const startTime = performance.now();
    
    const instance = autocannon({
      url: `${this.config.apiUrl}${scenario.endpoint}`,
      method: scenario.method || 'GET',
      headers: scenario.headers,
      body: scenario.body,
      connections: this.config.connections,
      duration: scenario.duration || this.config.duration,
      pipelining: this.config.pipelining,
      ...(scenario.rps ? { overallRate: scenario.rps } : {})
    });

    const result = await new Promise<any>((resolve) => {
      instance.on('done', (result) => resolve(result));
    });

    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;

    const benchmarkResult: BenchmarkResult = {
      scenario: scenario.name,
      requests: {
        total: result.requests.total,
        persec: result.requests.mean
      },
      latency: {
        min: result.latency.min,
        max: result.latency.max,
        mean: result.latency.mean,
        stddev: result.latency.stddev,
        p50: result.latency.p50,
        p90: result.latency.p90 || result.latency.p99,
        p95: result.latency.p95 || result.latency.p99,
        p99: result.latency.p99
      },
      throughput: {
        total: result.throughput.total,
        persec: result.throughput.mean
      },
      errors: result.errors,
      errorRate: (result.errors / result.requests.total) * 100,
      timeouts: result.timeouts,
      duration,
      passed: this.checkThresholds(result, scenario.thresholds)
    };

    this.results.push(benchmarkResult);
    return benchmarkResult;
  }

  private checkThresholds(
    result: any,
    thresholds?: ScenarioConfig['thresholds']
  ): boolean {
    if (!thresholds) return true;

    if (thresholds.p95 && result.latency.p95 > thresholds.p95) {
      return false;
    }

    if (thresholds.p99 && result.latency.p99 > thresholds.p99) {
      return false;
    }

    if (thresholds.errorRate) {
      const errorRate = (result.errors / result.requests.total) * 100;
      if (errorRate > thresholds.errorRate) {
        return false;
      }
    }

    return true;
  }

  async runAll(): Promise<void> {
    await this.setup();
    await this.warmup();

    for (const scenario of this.config.scenarios) {
      const result = await this.runScenario(scenario);
      this.printResult(result);
    }

    await this.cleanup();
  }

  private printResult(result: BenchmarkResult): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scenario: ${result.scenario}`);
    console.log('='.repeat(60));
    console.log(`Requests: ${result.requests.total} total, ${result.requests.persec.toFixed(2)}/sec`);
    console.log(`Latency (ms):`);
    console.log(`  Min: ${result.latency.min}`);
    console.log(`  Max: ${result.latency.max}`);
    console.log(`  Mean: ${result.latency.mean.toFixed(2)}`);
    console.log(`  P50: ${result.latency.p50}`);
    console.log(`  P90: ${result.latency.p90}`);
    console.log(`  P95: ${result.latency.p95}`);
    console.log(`  P99: ${result.latency.p99}`);
    console.log(`Throughput: ${(result.throughput.persec / 1024 / 1024).toFixed(2)} MB/sec`);
    console.log(`Errors: ${result.errors} (${result.errorRate.toFixed(2)}%)`);
    console.log(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up benchmark environment');

    if (this.pool) {
      await this.pool.end();
    }

    if (this.redis) {
      await this.redis.quit();
    }

    if (this.kafka) {
      // Cleanup Kafka connections
    }
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }

  generateReport(): string {
    const report: string[] = [];
    
    report.push('# Performance Benchmark Report');
    report.push(`Date: ${new Date().toISOString()}`);
    report.push(`API URL: ${this.config.apiUrl}`);
    report.push('');

    for (const result of this.results) {
      report.push(`## ${result.scenario}`);
      report.push(`- Requests: ${result.requests.total} (${result.requests.persec.toFixed(2)}/sec)`);
      report.push(`- P95 Latency: ${result.latency.p95}ms`);
      report.push(`- P99 Latency: ${result.latency.p99}ms`);
      report.push(`- Error Rate: ${result.errorRate.toFixed(2)}%`);
      report.push(`- Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
      report.push('');
    }

    const allPassed = this.results.every(r => r.passed);
    report.push(`## Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

    return report.join('\n');
  }

  async exportResults(format: 'json' | 'csv' | 'html' = 'json'): Promise<string> {
    switch (format) {
      case 'json':
        return JSON.stringify(this.results, null, 2);
      
      case 'csv':
        const headers = [
          'Scenario',
          'Total Requests',
          'Requests/sec',
          'P50 Latency',
          'P95 Latency',
          'P99 Latency',
          'Error Rate',
          'Status'
        ].join(',');

        const rows = this.results.map(r => [
          r.scenario,
          r.requests.total,
          r.requests.persec.toFixed(2),
          r.latency.p50,
          r.latency.p95,
          r.latency.p99,
          r.errorRate.toFixed(2),
          r.passed ? 'PASSED' : 'FAILED'
        ].join(','));

        return [headers, ...rows].join('\n');

      case 'html':
        return this.generateHtmlReport();

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private generateHtmlReport(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Performance Benchmark Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .passed { color: green; font-weight: bold; }
    .failed { color: red; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Performance Benchmark Report</h1>
  <p>Date: ${new Date().toISOString()}</p>
  <p>API URL: ${this.config.apiUrl}</p>
  
  <table>
    <tr>
      <th>Scenario</th>
      <th>Total Requests</th>
      <th>Requests/sec</th>
      <th>P50 Latency (ms)</th>
      <th>P95 Latency (ms)</th>
      <th>P99 Latency (ms)</th>
      <th>Error Rate (%)</th>
      <th>Status</th>
    </tr>
    ${this.results.map(r => `
    <tr>
      <td>${r.scenario}</td>
      <td>${r.requests.total}</td>
      <td>${r.requests.persec.toFixed(2)}</td>
      <td>${r.latency.p50}</td>
      <td>${r.latency.p95}</td>
      <td>${r.latency.p99}</td>
      <td>${r.errorRate.toFixed(2)}</td>
      <td class="${r.passed ? 'passed' : 'failed'}">
        ${r.passed ? 'PASSED' : 'FAILED'}
      </td>
    </tr>
    `).join('')}
  </table>
</body>
</html>
    `;
  }
}

// CLI runner
if (require.main === module) {
  const benchmark = new PerformanceBenchmark();
  
  benchmark.runAll()
    .then(() => {
      console.log('\n' + benchmark.generateReport());
      process.exit(0);
    })
    .catch((error) => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });
}