import express from 'express';
import { getServiceConfig } from '@ms5/shared/config';
import { loggerMiddleware } from '@ms5/shared/logger';
import { errorHandler } from '@ms5/shared/errors/http-error';
import apiRouter from './routes/api';
import healthRouter from './routes/health';

const config = getServiceConfig('dms-service');

export function createServer(): express.Application {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(loggerMiddleware('dms-service'));

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(errorHandler);

  return app;
}