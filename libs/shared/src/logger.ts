import pino from 'pino';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getConfig, isDevelopment } from './config';

const config = getConfig();

const transportOptions = isDevelopment() && config.LOG_PRETTY
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const createLogger = (serviceName: string, metadata?: Record<string, unknown>): pino.Logger => {
  return pino({
    name: serviceName,
    level: config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        query: req.query,
        params: req.params,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-request-id': req.headers['x-request-id'],
        },
      }),
      res: (res) => ({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
      }),
    },
    base: {
      service: serviceName,
      env: config.NODE_ENV,
      ...metadata,
    },
    transport: transportOptions,
  });
};

export const logger = createLogger(config.SERVICE_NAME);

// Extend Express Request type to include our custom properties
declare module 'express' {
  interface Request {
    id?: string;
    log?: pino.Logger;
  }
}

export const loggerMiddleware = (serviceName: string) => {
  const serviceLogger = createLogger(serviceName);

  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();

    req.id = requestId;
    req.log = serviceLogger.child({ requestId });

    req.log.info({ req }, 'Request received');

    const originalSend = res.send;
    res.send = function (data: unknown): Response {
      const duration = Date.now() - startTime;
      req.log.info(
        {
          res,
          duration,
          responseSize: typeof data === 'string' ? data.length : JSON.stringify(data).length,
        },
        'Request completed',
      );
      return originalSend.call(this, data) as Response;
    };

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      if (res.statusCode >= 400) {
        req.log.error(
          {
            res,
            duration,
          },
          'Request failed',
        );
      }
    });

    next();
  };
};

export const auditLog = async (
  action: string,
  resource: string,
  userId: string,
  result: 'SUCCESS' | 'FAILURE' | 'DENIED',
  metadata?: Record<string, unknown>,
): Promise<void> => {
  const auditLogger = createLogger('audit');

  auditLogger.info({
    timestamp: new Date().toISOString(),
    userId,
    action,
    resource,
    result,
    metadata,
  }, 'Audit log entry');
};

export const securityLog = async (
  event: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  metadata?: Record<string, unknown>,
): Promise<void> => {
  const securityLogger = createLogger('security');

  securityLogger.warn({
    timestamp: new Date().toISOString(),
    event,
    severity,
    metadata,
  }, 'Security event');
};