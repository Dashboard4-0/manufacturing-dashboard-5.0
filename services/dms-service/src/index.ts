import 'express-async-errors';
import { createServer } from './server';
import { getServiceConfig } from '@ms5/shared/config';
import { createLogger } from '@ms5/shared/logger';
import { initializeTracing } from '@ms5/shared/observability/otel';
import { KafkaConsumer } from './events/consumer';
import { PrismaClient } from '@prisma/client';

const config = getServiceConfig('dms-service');
const logger = createLogger('dms-service');
const prisma = new PrismaClient();

async function start(): Promise<void> {
  try {
    await initializeTracing('dms-service');

    await prisma.$connect();
    logger.info('Database connected');

    const kafkaConsumer = new KafkaConsumer();
    await kafkaConsumer.start();
    logger.info('Kafka consumer started');

    const server = createServer();
    const port = config.PORT || 3001;

    server.listen(port, () => {
      logger.info({ port }, 'DMS Service started');
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
    logger.error({ error }, 'Failed to start DMS service');
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error({ error }, 'Unhandled error during startup');
  process.exit(1);
});