import 'express-async-errors';
import { createServer } from './server';
import { getServiceConfig } from '@ms5/shared/config';
import { createLogger } from '@ms5/shared/logger';
import { OPCUAService } from './opcua/client';
import { JournalService } from './journal/store';
import { SyncWorker } from './journal/sync-worker';
import * as cron from 'node-cron';

const config = getServiceConfig('edge-gateway');
const logger = createLogger('edge-gateway');

async function start(): Promise<void> {
  try {
    // Initialize journal
    const journal = new JournalService();
    await journal.initialize();
    logger.info('Journal service initialized');

    // Initialize OPC UA client
    const opcuaService = new OPCUAService(journal);
    await opcuaService.connect();
    logger.info('OPC UA client connected');

    // Initialize sync worker
    const syncWorker = new SyncWorker(journal);

    // Schedule sync every minute
    cron.schedule('* * * * *', async () => {
      try {
        await syncWorker.syncToCloud();
      } catch (error) {
        logger.error({ error }, 'Sync failed');
      }
    });

    // Schedule clock sanity check every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await syncWorker.checkClockSanity();
      } catch (error) {
        logger.error({ error }, 'Clock sanity check failed');
      }
    });

    logger.info('Sync worker scheduled');

    const server = createServer(journal);
    const port = config.PORT || 3019;

    server.listen(port, () => {
      logger.info({ port }, 'Edge Gateway started');
    });

    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'Shutdown signal received');

      server.close(() => {
        logger.info('HTTP server closed');
      });

      await opcuaService.disconnect();
      await journal.close();

      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Failed to start Edge Gateway');
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error({ error }, 'Unhandled error during startup');
  process.exit(1);
});