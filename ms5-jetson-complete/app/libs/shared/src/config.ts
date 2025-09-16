import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  SERVICE_NAME: z.string().default('ms5-service'),

  DATABASE_URL: z.string().url().optional(),
  TIMESCALE_URL: z.string().url().optional(),

  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().optional(),
  KAFKA_GROUP_ID: z.string().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.string().transform(Number).default('9000'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin123'),
  MINIO_USE_SSL: z.string().transform(v => v === 'true').default('false'),

  OPENSEARCH_URL: z.string().default('http://localhost:9200'),

  VAULT_ADDR: z.string().default('http://localhost:8200'),
  VAULT_TOKEN: z.string().optional(),
  VAULT_NAMESPACE: z.string().optional(),

  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  JWT_SECRET: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_TRACES_ENABLED: z.string().transform(v => v === 'true').default('true'),
  OTEL_METRICS_ENABLED: z.string().transform(v => v === 'true').default('true'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.string().transform(v => v === 'true').default('true'),

  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),
  RATE_LIMIT_MAX: z.string().transform(Number).default('100'),
  RATE_LIMIT_WINDOW: z.string().transform(Number).default('60000'),

  SHUTDOWN_TIMEOUT: z.string().transform(Number).default('10000'),
  HEALTH_CHECK_INTERVAL: z.string().transform(Number).default('30000'),
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    try {
      cachedConfig = envSchema.parse(process.env);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const missingVars = error.errors.map(e => e.path.join('.')).join(', ');
        throw new Error(`Configuration validation failed. Missing or invalid environment variables: ${missingVars}`);
      }
      throw error;
    }
  }
  return cachedConfig;
}

export function getServiceConfig(serviceName: string): Config {
  const config = getConfig();
  return {
    ...config,
    SERVICE_NAME: serviceName,
    OTEL_SERVICE_NAME: serviceName,
    KAFKA_CLIENT_ID: `${serviceName}-client`,
    KAFKA_GROUP_ID: `${serviceName}-group`,
  };
}

export function isDevelopment(): boolean {
  return getConfig().NODE_ENV === 'development';
}

export function isProduction(): boolean {
  return getConfig().NODE_ENV === 'production';
}

export function isTest(): boolean {
  return getConfig().NODE_ENV === 'test';
}

export function getKafkaBrokers(): string[] {
  return getConfig().KAFKA_BROKERS.split(',').map(b => b.trim());
}

export function getCorsOrigins(): string[] {
  return getConfig().CORS_ORIGINS.split(',').map(o => o.trim());
}

export function getVaultPath(key: string): string {
  const namespace = getConfig().VAULT_NAMESPACE || 'ms5';
  return `secret/data/${namespace}/${key}`;
}