import 'express-async-errors';
import { createServer } from './server';
import { getServiceConfig } from '@ms5/shared/config';
import { createLogger } from '@ms5/shared/logger';
import { initializeTracing } from '@ms5/shared/observability/otel';
import { KafkaConsumer } from './events/consumer';
import { PrismaClient } from '@prisma/client';
import { AnalyticsRunner } from './jobs/analytics-runner';
import * as cron from 'node-cron';

const config = getServiceConfig('loss-analytics-service');
const logger = createLogger('loss-analytics-service');
const prisma = new PrismaClient();

async function start(): Promise<void> {
  try {
    await initializeTracing('loss-analytics-service');

    await prisma.$connect();
    logger.info('Database connected');

    const kafkaConsumer = new KafkaConsumer();
    await kafkaConsumer.start();
    logger.info('Kafka consumer started');

    const analyticsRunner = new AnalyticsRunner();

    // Schedule OEE calculations every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        await analyticsRunner.calculateOEE();
      } catch (error) {
        logger.error({ error }, 'Failed to calculate OEE');
      }
    });

    // Schedule loss analytics every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await analyticsRunner.analyzeLosses();
      } catch (error) {
        logger.error({ error }, 'Failed to analyze losses');
      }
    });

    logger.info('Analytics jobs scheduled');

    const server = createServer();
    const port = config.PORT || 3002;

    server.listen(port, () => {
      logger.info({ port }, 'Loss Analytics Service started');
    });

    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Shutdown signal received');

      server.close(() => {
        logger.info('HTTP server closed');
      });

      await kafkaConsumer.stop();
      await prisma.$disconnect();

      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Failed to start Loss Analytics service');
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error({ error }, 'Unhandled error during startup');
  process.exit(1);
});