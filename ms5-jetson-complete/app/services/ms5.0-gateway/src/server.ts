import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { getServiceConfig, getCorsOrigins } from '@ms5/shared/config';
import { loggerMiddleware, createLogger } from '@ms5/shared/logger';
import { schema } from './graphql/schema';
import { createContext } from './graphql/context';
import { authMiddleware } from './middleware/auth';

const config = getServiceConfig('ms5-gateway');
const logger = createLogger('ms5-gateway');

const app = express();
const httpServer = createServer(app);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql',
});

const serverCleanup = useServer(
  {
    schema,
    context: createContext,
  },
  wsServer
);

const apolloServer = new ApolloServer({
  schema,
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP',
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

app.use(cors({
  origin: getCorsOrigins(),
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(loggerMiddleware('ms5-gateway'));
app.use(limiter);

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'ms5-gateway', timestamp: new Date().toISOString() });
});

app.get('/ready', async (_req, res) => {
  try {
    res.json({ status: 'ready', service: 'ms5-gateway' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send('# Prometheus metrics endpoint\n');
});

app.get('/version', (_req, res) => {
  res.json({
    service: 'ms5-gateway',
    version: '1.0.0',
    buildTime: new Date().toISOString(),
    gitCommit: process.env.GIT_COMMIT || 'unknown',
  });
});

const services = [
  { path: '/api/v1/dms', target: 'http://dms-service:3001' },
  { path: '/api/v1/analytics', target: 'http://loss-analytics-service:3002' },
  { path: '/api/v1/operator', target: 'http://operator-care-service:3003' },
  { path: '/api/v1/maintenance', target: 'http://pm-planner-service:3004' },
  { path: '/api/v1/centerline', target: 'http://centerline-service:3005' },
  { path: '/api/v1/quality', target: 'http://quality-spc-service:3006' },
  { path: '/api/v1/assets', target: 'http://early-asset-mgmt-service:3007' },
  { path: '/api/v1/standard-work', target: 'http://standard-work-service:3008' },
  { path: '/api/v1/problems', target: 'http://problem-solving-service:3009' },
  { path: '/api/v1/andon', target: 'http://andon-service:3010' },
  { path: '/api/v1/handover', target: 'http://handover-service:3011' },
  { path: '/api/v1/safety', target: 'http://safety-service:3012' },
  { path: '/api/v1/skills', target: 'http://skills-service:3013' },
  { path: '/api/v1/energy', target: 'http://energy-service:3014' },
  { path: '/api/v1/compliance', target: 'http://compliance-audit-service:3015' },
  { path: '/api/v1/master-data', target: 'http://master-data-service:3016' },
  { path: '/api/v1/integration', target: 'http://integration-hub:3017' },
  { path: '/api/v1/governance', target: 'http://governance-maturity-service:3018' },
];

services.forEach(({ path, target }) => {
  app.use(
    path,
    authMiddleware,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      onError: (err, _req, res) => {
        logger.error({ error: err, path, target }, 'Proxy error');
        if (res.writeHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Service unavailable' }));
      },
    })
  );
});

export const server = {
  async listen(port: number): Promise<void> {
    await apolloServer.start();

    app.use(
      '/graphql',
      expressMiddleware(apolloServer, {
        context: createContext,
      })
    );

    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        logger.info({ port, graphql: `http://localhost:${port}/graphql` }, 'Server started');
        resolve();
      });
    });
  },

  async close(): Promise<void> {
    await apolloServer.stop();
    return new Promise((resolve) => {
      httpServer.close(() => {
        logger.info('Server closed');
        resolve();
      });
    });
  },
};