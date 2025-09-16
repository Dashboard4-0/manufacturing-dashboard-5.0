import { server } from './server';
import { getServiceConfig } from '@ms5/shared/config';
import { createLogger } from '@ms5/shared/logger';
import { initializeTracing } from '@ms5/shared/observability/otel';

const config = getServiceConfig('ms5-gateway');
const logger = createLogger('ms5-gateway');

async function start(): Promise<void> {
  try {
    await initializeTracing('ms5-gateway');

    const port = config.PORT || 3000;
    await server.listen(port);

    logger.info({ port }, 'MS5.0 Gateway started');

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await server.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start gateway');
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error({ error }, 'Unhandled error during startup');
  process.exit(1);
});