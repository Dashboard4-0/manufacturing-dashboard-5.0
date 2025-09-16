# MS5.0 Q&A Audit - Improvement Implementation Plan

## 🔴 Critical Issues to Fix (P0)

### 1. TypeScript Type Safety Violations

#### Issue: Extensive use of `any` types (50+ violations)

**Impact**: Loss of type safety, potential runtime errors, reduced IDE support

#### Fix Implementation:

```typescript
// ❌ BEFORE: libs/shared/src/auth/oidc.ts:26
private discoveryDocument: any = null;

// ✅ AFTER: Create proper type definition
interface OIDCDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  scopes_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
}

private discoveryDocument: OIDCDiscoveryDocument | null = null;
```

```typescript
// ❌ BEFORE: services/edge-gateway/src/journal/store.ts
const result: any = this.db.prepare('SELECT * FROM events').all();

// ✅ AFTER: Define proper types
interface JournalEvent {
  id: string;
  type: string;
  assetId: string;
  data: Record<string, unknown>;
  signature: string;
  previousSignature: string | null;
  timestamp: string;
  synced: boolean;
}

const result = this.db.prepare<JournalEvent>('SELECT * FROM events').all();
```

```typescript
// ❌ BEFORE: GraphQL context with any
export interface GraphQLContext {
  user: any;
  dataSources: any;
  req: any;
  res: any;
}

// ✅ AFTER: Properly typed context
import { Request, Response } from 'express';
import { User } from '@prisma/client';

export interface GraphQLContext {
  user: User | null;
  dataSources: {
    dmsAPI: DMSDataSource;
    lossAnalyticsAPI: LossAnalyticsDataSource;
    authAPI: AuthDataSource;
  };
  req: Request;
  res: Response;
  correlationId: string;
}
```

### 2. Missing Critical Documentation

#### Create Essential Documentation Files:

**docs/API.md** - API Documentation

````markdown
# MS5.0 API Documentation

## Authentication

All API endpoints require Bearer token authentication.

### POST /api/auth/login

Login with credentials and receive JWT token.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "password"
}
```
````

**Response:**

```json
{
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "role": "operator"
  }
}
```

## GraphQL API

### Endpoint: `/graphql`

#### Queries

```graphql
# Get production lines with current status
query GetProductionLines {
  productionLines {
    id
    name
    status
    currentOEE
    currentShift
  }
}

# Get SQDC actions
query GetActions($boardType: BoardType!, $status: ActionStatus) {
  actions(boardType: $boardType, status: $status) {
    id
    boardType
    category
    description
    status
    assignedTo
    dueDate
  }
}
```

#### Mutations

```graphql
# Create new SQDC action
mutation CreateAction($input: CreateActionInput!) {
  createAction(input: $input) {
    id
    boardType
    category
    status
  }
}
```

#### Subscriptions

```graphql
# Subscribe to Andon triggers
subscription OnAndonTriggered {
  andonTriggered {
    id
    type
    lineId
    stationId
    triggeredAt
  }
}
```

````

**docs/OPERATIONS.md** - Operations Guide
```markdown
# MS5.0 Operations Guide

## System Requirements
- Kubernetes 1.28+
- PostgreSQL 15+ with TimescaleDB 2.14+
- Kafka 3.6+
- Redis 7+
- 16GB RAM minimum (production)
- 4 CPU cores minimum (production)

## Deployment

### Production Deployment
```bash
# Deploy to AKS
kubectl apply -k infra/k8s/overlays/production

# Verify deployment
kubectl get pods -n ms5
kubectl get svc -n ms5
````

### Monitoring

- Prometheus: http://prometheus.ms5.local:9090
- Grafana: http://grafana.ms5.local:3000
- Jaeger: http://jaeger.ms5.local:16686

## Backup & Recovery

### Database Backup

```bash
# Automated backup runs daily at 02:00 UTC
# Manual backup
kubectl exec -n ms5 postgres-0 -- pg_dump -U ms5user ms5db > backup-$(date +%Y%m%d).sql

# Restore from backup
kubectl exec -n ms5 postgres-0 -- psql -U ms5user ms5db < backup-20250115.sql
```

### Disaster Recovery

1. **RTO Target**: 5 minutes
2. **RPO Target**: 15 minutes

#### Failover Procedure

```bash
# 1. Verify primary failure
kubectl get pods -n ms5 -l app=postgres

# 2. Promote secondary
kubectl patch statefulset postgres -n ms5 --type='json' \
  -p='[{"op": "replace", "path": "/spec/replicas", "value":0}]'

# 3. Update connection strings
kubectl set env deployment/ms5-gateway -n ms5 \
  DATABASE_URL="postgresql://ms5user:password@postgres-secondary:5432/ms5db"

# 4. Verify services
kubectl get pods -n ms5 --watch
```

## Troubleshooting

### Common Issues

#### High Memory Usage

```bash
# Check memory usage
kubectl top pods -n ms5

# Restart problematic pod
kubectl delete pod <pod-name> -n ms5
```

#### Kafka Consumer Lag

```bash
# Check consumer lag
kubectl exec -n kafka kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group ms5-consumer-group

# Reset consumer offset
kubectl exec -n kafka kafka-0 -- kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --group ms5-consumer-group \
  --reset-offsets --to-earliest --execute --all-topics
```

````

**docs/SECURITY.md** - Security Guide
```markdown
# MS5.0 Security Guide

## Authentication & Authorisation

### OIDC Configuration
The system uses Azure AD for authentication via OIDC.

**Environment Variables:**
- `OIDC_ISSUER`: Azure AD tenant URL
- `OIDC_CLIENT_ID`: Application client ID
- `OIDC_CLIENT_SECRET`: Application secret (stored in Vault)

### RBAC Roles
| Role | Permissions |
|------|------------|
| admin | Full system access |
| manager | Read/write all production data |
| supervisor | Read/write assigned lines |
| operator | Read/write assigned station |

## Security Best Practices

### Secrets Management
All secrets are stored in HashiCorp Vault:
```bash
# Read database password
vault kv get -field=password secret/ms5/database

# Rotate secrets
vault kv put secret/ms5/database password=$(openssl rand -base64 32)
````

### Network Security

- All traffic encrypted with TLS 1.3
- mTLS between services
- Network policies enforce microsegmentation
- Rate limiting: 100 requests/minute per IP

### Audit Logging

All user actions are logged with hash-chain integrity:

```sql
-- Verify audit log integrity
SELECT COUNT(*) FROM audit_logs
WHERE verify_hash_chain(signature, previous_signature, data) = false;
```

## Incident Response

### Security Incident Procedure

1. **Detect**: Monitor alerts in Grafana
2. **Contain**: Isolate affected services
3. **Investigate**: Review audit logs and traces
4. **Remediate**: Apply fixes and patches
5. **Document**: Create incident report

### Emergency Contacts

- Security Team: security@ms5.example.com
- On-Call: +44-XXX-XXXX (PagerDuty)

````

### 3. Database Backup Strategy

**Create backup CronJob:**
```yaml
# infra/k8s/base/backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: ms5
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM UTC
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: postgres-backup
            image: postgres:15-alpine
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secret
                  key: password
            command:
            - /bin/sh
            - -c
            - |
              DATE=$(date +%Y%m%d-%H%M%S)
              pg_dump -h postgres -U ms5user -d ms5db | gzip > /backup/ms5db-$DATE.sql.gz

              # Keep only last 30 days of backups
              find /backup -name "*.sql.gz" -mtime +30 -delete

              # Upload to cloud storage
              az storage blob upload \
                --account-name ms5backups \
                --container-name postgres \
                --name ms5db-$DATE.sql.gz \
                --file /backup/ms5db-$DATE.sql.gz
            volumeMounts:
            - name: backup
              mountPath: /backup
          volumes:
          - name: backup
            persistentVolumeClaim:
              claimName: backup-pvc
          restartPolicy: OnFailure
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: backup-pvc
  namespace: ms5
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: managed-premium
````

### 4. Testing Improvements

**Add missing test files:**

```typescript
// services/ms5.0-gateway/src/middleware/__tests__/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../auth';
import { verifyToken } from '@ms5/shared';

vi.mock('@ms5/shared', () => ({
  verifyToken: vi.fn(),
}));

describe('Auth Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      headers: {},
      body: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('should reject requests without token', async () => {
    await authMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'No authorization token provided',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject invalid tokens', async () => {
    req.headers = { authorization: 'Bearer invalid-token' };
    (verifyToken as any).mockRejectedValue(new Error('Invalid token'));

    await authMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid token',
    });
  });

  it('should allow valid tokens', async () => {
    req.headers = { authorization: 'Bearer valid-token' };
    const user = { id: 'user-1', role: 'operator' };
    (verifyToken as any).mockResolvedValue(user);

    await authMiddleware(req as Request, res as Response, next);

    expect(req.user).toEqual(user);
    expect(next).toHaveBeenCalled();
  });

  it('should handle RBAC permissions', async () => {
    req.headers = { authorization: 'Bearer valid-token' };
    req.path = '/api/admin';
    const user = { id: 'user-1', role: 'operator' };
    (verifyToken as any).mockResolvedValue(user);

    await authMiddleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Insufficient permissions',
    });
  });
});
```

## 🟡 High Priority Improvements (P1)

### 1. Performance Optimisations

**Implement Query Result Caching:**

```typescript
// libs/shared/src/cache/query-cache.ts
import { Redis } from 'ioredis';
import crypto from 'crypto';

export class QueryCache {
  constructor(private redis: Redis) {}

  async get<T>(query: string, params: any[]): Promise<T | null> {
    const key = this.generateKey(query, params);
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  async set<T>(query: string, params: any[], data: T, ttl = 300): Promise<void> {
    const key = this.generateKey(query, params);
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  private generateKey(query: string, params: any[]): string {
    const hash = crypto
      .createHash('md5')
      .update(query + JSON.stringify(params))
      .digest('hex');
    return `query:${hash}`;
  }
}

// Usage in service
const cache = new QueryCache(redis);

async function getOEEData(assetId: string) {
  // Check cache first
  const cached = await cache.get('SELECT * FROM oee WHERE asset_id = $1', [assetId]);
  if (cached) return cached;

  // Query database
  const result = await db.query('SELECT * FROM oee WHERE asset_id = $1', [assetId]);

  // Cache result
  await cache.set('SELECT * FROM oee WHERE asset_id = $1', [assetId], result, 60);

  return result;
}
```

**Add Database Connection Pooling:**

```typescript
// libs/shared/src/database/pool.ts
import { Pool } from 'pg';

export const createDatabasePool = () => {
  return new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20, // Maximum pool size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 10000, // 10 seconds
    query_timeout: 10000,
    application_name: 'ms5-app',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
};

// Add read replica support
export const createReadPool = () => {
  return new Pool({
    host: process.env.DB_READ_HOST || process.env.DB_HOST,
    // ... same config
    max: 30, // Higher limit for read queries
  });
};
```

### 2. GraphQL Performance

**Implement DataLoader for N+1 Prevention:**

```typescript
// services/ms5.0-gateway/src/dataloaders/index.ts
import DataLoader from 'dataloader';
import { prisma } from '../lib/prisma';

export const createDataLoaders = () => ({
  userLoader: new DataLoader(async (userIds: string[]) => {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
    });
    return userIds.map((id) => users.find((u) => u.id === id));
  }),

  actionLoader: new DataLoader(async (actionIds: string[]) => {
    const actions = await prisma.sQDCAction.findMany({
      where: { id: { in: actionIds } },
    });
    return actionIds.map((id) => actions.find((a) => a.id === id));
  }),

  lineLoader: new DataLoader(async (lineIds: string[]) => {
    const lines = await prisma.productionLine.findMany({
      where: { id: { in: lineIds } },
    });
    return lineIds.map((id) => lines.find((l) => l.id === id));
  }),
});

// Add to GraphQL context
const server = new ApolloServer({
  schema,
  context: ({ req, res }) => ({
    req,
    res,
    dataloaders: createDataLoaders(),
    user: req.user,
  }),
});
```

### 3. Monitoring Enhancements

**Add Custom Metrics:**

```typescript
// libs/shared/src/metrics/custom.ts
import { Counter, Histogram, Gauge, register } from 'prom-client';

// Business metrics
export const oeeGauge = new Gauge({
  name: 'ms5_oee_percentage',
  help: 'Current OEE percentage by line',
  labelNames: ['line_id', 'shift'],
});

export const andonCounter = new Counter({
  name: 'ms5_andon_triggers_total',
  help: 'Total Andon triggers by type',
  labelNames: ['type', 'line_id', 'resolved'],
});

export const actionCompletionTime = new Histogram({
  name: 'ms5_action_completion_duration_hours',
  help: 'Time to complete SQDC actions',
  labelNames: ['board_type', 'category'],
  buckets: [1, 4, 8, 24, 48, 72, 168], // Hours
});

export const dataIngestionRate = new Gauge({
  name: 'ms5_data_ingestion_rate',
  help: 'Data points ingested per second',
  labelNames: ['source', 'type'],
});

register.registerMetric(oeeGauge);
register.registerMetric(andonCounter);
register.registerMetric(actionCompletionTime);
register.registerMetric(dataIngestionRate);
```

## 🟢 Medium Priority Improvements (P2)

### 1. Advanced Caching Strategy

```yaml
# infra/k8s/base/redis-cluster.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-cluster
  namespace: ms5
spec:
  serviceName: redis-cluster
  replicas: 6
  selector:
    matchLabels:
      app: redis-cluster
  template:
    metadata:
      labels:
        app: redis-cluster
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          command: ['redis-server']
          args:
            - --cluster-enabled yes
            - --cluster-config-file nodes.conf
            - --cluster-node-timeout 5000
            - --appendonly yes
            - --maxmemory 2gb
            - --maxmemory-policy allkeys-lru
          ports:
            - containerPort: 6379
            - containerPort: 16379
          resources:
            requests:
              memory: '2Gi'
              cpu: '500m'
            limits:
              memory: '4Gi'
              cpu: '1000m'
```

### 2. API Rate Limiting per User

```typescript
// services/ms5.0-gateway/src/middleware/rate-limit.ts
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '../lib/redis';

const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rate-limit',
  points: 100, // Number of requests
  duration: 60, // Per 60 seconds
  blockDuration: 60, // Block for 1 minute
});

const userRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'user-rate-limit',
  points: 1000, // Higher limit for authenticated users
  duration: 60,
  blockDuration: 60,
});

export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.user ? req.user.id : req.ip;
    const limiter = req.user ? userRateLimiter : rateLimiter;

    await limiter.consume(key);
    next();
  } catch (rejRes) {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 60,
    });
  }
};
```

## 🔵 Low Priority Improvements (P3)

### 1. Bundle Size Optimisation

```typescript
// apps/web/vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          apollo: ['@apollo/client', 'graphql'],
          charts: ['recharts', 'd3-scale', 'd3-shape'],
          ui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          utils: ['date-fns', 'lodash-es', 'uuid'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@apollo/client'],
  },
});
```

### 2. Advanced Monitoring Dashboards

```json
// grafana/dashboards/ms5-overview.json
{
  "dashboard": {
    "title": "MS5.0 Manufacturing Overview",
    "panels": [
      {
        "title": "Real-time OEE by Line",
        "targets": [
          {
            "expr": "ms5_oee_percentage",
            "legendFormat": "{{line_id}}"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Andon Response Time",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(ms5_andon_response_time_bucket[5m]))",
            "legendFormat": "P95 Response Time"
          }
        ],
        "type": "stat"
      },
      {
        "title": "Data Ingestion Rate",
        "targets": [
          {
            "expr": "sum(rate(ms5_data_ingestion_rate[1m])) by (source)",
            "legendFormat": "{{source}}"
          }
        ],
        "type": "timeseries"
      }
    ]
  }
}
```

## Implementation Timeline

| Week | Tasks                          | Team              |
| ---- | ------------------------------ | ----------------- |
| 1    | Fix TypeScript type violations | Dev Team          |
| 1    | Create missing documentation   | Tech Writer + Dev |
| 2    | Implement backup strategy      | DevOps            |
| 2    | Add missing tests              | QA + Dev          |
| 3    | Performance optimisations      | Dev Team          |
| 3    | API documentation              | Tech Writer       |
| 4    | Monitoring enhancements        | DevOps            |
| 4    | Security hardening             | Security Team     |

## Success Metrics

- **Type Safety**: 0 TypeScript `any` violations
- **Test Coverage**: >90% code coverage
- **Documentation**: 100% API endpoints documented
- **Performance**: P95 latency <200ms
- **Reliability**: 99.9% uptime
- **Security**: 0 critical vulnerabilities
- **Backup**: Daily automated backups with <1 hour RPO

## Conclusion

Implementing these improvements will elevate the MS5.0 Manufacturing System from a well-architected
prototype to a production-grade enterprise system. Priority should be given to P0 items as they
represent genuine production blockers, followed by P1 items that significantly enhance operational
excellence.
