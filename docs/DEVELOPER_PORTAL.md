# MS5.0 Developer Portal

## Overview

Welcome to the MS5.0 Manufacturing System Developer Portal. This comprehensive guide provides
everything you need to integrate with, extend, and develop applications on top of the MS5.0
platform.

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm 8+
- Docker and Docker Compose
- PostgreSQL 15+ with TimescaleDB
- Redis 7+
- Kafka 3.6+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/ms5.0.git
cd ms5.0

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure
docker-compose up -d

# Run migrations
pnpm migrate

# Start development servers
pnpm dev
```

## API Reference

### Authentication

MS5.0 uses OAuth 2.0 with OpenID Connect for authentication.

#### Obtaining Access Token

```typescript
const response = await fetch('https://api.ms5.com/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: 'your_client_id',
    client_secret: 'your_client_secret',
    scope: 'read:telemetry write:events',
  }),
});

const { access_token } = await response.json();
```

### REST API

#### Base URL

```
Production: https://api.ms5.com/v2
Staging: https://staging-api.ms5.com/v2
Local: http://localhost:4000/api/v2
```

#### Common Endpoints

##### Production Lines

```http
GET /api/v2/lines
GET /api/v2/lines/{id}
POST /api/v2/lines
PUT /api/v2/lines/{id}
DELETE /api/v2/lines/{id}
```

##### Telemetry

```http
GET /api/v2/telemetry?assetId={id}&from={timestamp}&to={timestamp}
POST /api/v2/telemetry/batch
```

##### Events

```http
GET /api/v2/events?type={type}&severity={severity}
POST /api/v2/events
```

### GraphQL API

#### Endpoint

```
POST /graphql
```

#### Schema

```graphql
type Query {
  productionLine(id: ID!): ProductionLine
  productionLines(filter: LineFilter): [ProductionLine!]!

  oeeMetrics(lineId: ID!, timeRange: TimeRange!, aggregation: AggregationType): OEEMetrics

  andonCalls(status: AndonStatus, lineId: ID): [AndonCall!]!
}

type Mutation {
  createProductionLine(input: CreateLineInput!): ProductionLine!
  triggerAndon(input: TriggerAndonInput!): AndonCall!
  acknowledgeAndon(id: ID!): AndonCall!
  resolveAndon(id: ID!, resolution: String!): AndonCall!
}

type Subscription {
  telemetryUpdates(assetId: ID!): TelemetryData!
  andonTriggered(lineId: ID): AndonCall!
  oeeUpdated(lineId: ID!): OEEMetrics!
}
```

#### Example Query

```graphql
query GetProductionMetrics {
  productionLine(id: "line-001") {
    id
    name
    currentOEE
    assets {
      id
      name
      status
    }
  }

  oeeMetrics(
    lineId: "line-001"
    timeRange: { from: "2024-01-01", to: "2024-01-31" }
    aggregation: DAILY
  ) {
    availability
    performance
    quality
    oee
  }
}
```

### WebSocket API

#### Connection

```typescript
const ws = new WebSocket('wss://api.ms5.com/ws', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

ws.on('open', () => {
  // Subscribe to telemetry updates
  ws.send(
    JSON.stringify({
      type: 'subscribe',
      channel: 'telemetry',
      filters: { assetId: 'asset-001' },
    }),
  );
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
});
```

## SDKs

### TypeScript/JavaScript

```bash
npm install @ms5/sdk
```

```typescript
import { MS5Client } from '@ms5/sdk';

const client = new MS5Client({
  apiKey: 'your_api_key',
  environment: 'production',
});

// Fetch production line data
const line = await client.productionLines.get('line-001');

// Subscribe to real-time updates
client.telemetry.subscribe('asset-001', (data) => {
  console.log('Telemetry:', data);
});
```

### Python

```bash
pip install ms5-sdk
```

```python
from ms5_sdk import MS5Client

client = MS5Client(
    api_key="your_api_key",
    environment="production"
)

# Fetch OEE metrics
metrics = client.oee.get_metrics(
    line_id="line-001",
    start_date="2024-01-01",
    end_date="2024-01-31"
)

# Trigger Andon
andon = client.andon.trigger(
    line_id="line-001",
    station_id="station-003",
    type="quality",
    severity="high"
)
```

## Webhooks

### Configuration

```json
{
  "url": "https://your-app.com/webhooks/ms5",
  "events": ["andon.triggered", "andon.resolved", "oee.threshold_exceeded", "maintenance.required"],
  "secret": "your_webhook_secret"
}
```

### Payload Structure

```json
{
  "event": "andon.triggered",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "andon-123",
    "lineId": "line-001",
    "stationId": "station-003",
    "type": "quality",
    "severity": "high",
    "description": "Quality issue detected"
  },
  "signature": "sha256=..."
}
```

### Signature Verification

```typescript
import crypto from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return `sha256=${expectedSignature}` === signature;
}
```

## Rate Limiting

### Limits

- **Standard**: 100 requests/minute
- **Premium**: 1000 requests/minute
- **Enterprise**: Custom limits

### Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T10:35:00Z
```

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Production line not found",
    "details": {
      "lineId": "line-999"
    },
    "requestId": "req_abc123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Common Error Codes

| Code                    | HTTP Status | Description                |
| ----------------------- | ----------- | -------------------------- |
| `AUTHENTICATION_FAILED` | 401         | Invalid or expired token   |
| `PERMISSION_DENIED`     | 403         | Insufficient permissions   |
| `RESOURCE_NOT_FOUND`    | 404         | Resource does not exist    |
| `VALIDATION_ERROR`      | 400         | Invalid request parameters |
| `RATE_LIMIT_EXCEEDED`   | 429         | Too many requests          |
| `INTERNAL_ERROR`        | 500         | Server error               |

## Development Tools

### API Explorer

Interactive API documentation available at:

- Production: https://api.ms5.com/explorer
- Local: http://localhost:4000/explorer

### Postman Collection

Download our Postman collection:

```bash
curl -O https://api.ms5.com/postman/ms5-api.json
```

### CLI Tool

```bash
npm install -g @ms5/cli

ms5 auth login
ms5 lines list
ms5 telemetry stream --asset-id asset-001
```

## Testing

### Test Environment

```typescript
const testClient = new MS5Client({
  apiKey: 'test_key_...',
  environment: 'sandbox',
});

// Sandbox environment provides:
// - Full API functionality
// - Test data that resets daily
// - No rate limiting
// - Webhook testing endpoints
```

### Mock Data

```typescript
import { mockData } from '@ms5/sdk/testing';

const mockLine = mockData.productionLine();
const mockTelemetry = mockData.telemetryStream({
  assetId: 'asset-001',
  interval: 1000,
});
```

## Best Practices

### 1. Pagination

Always use pagination for list endpoints:

```typescript
let hasMore = true;
let cursor = null;
const allLines = [];

while (hasMore) {
  const response = await client.productionLines.list({
    limit: 100,
    cursor,
  });

  allLines.push(...response.data);
  cursor = response.nextCursor;
  hasMore = !!cursor;
}
```

### 2. Error Retry

Implement exponential backoff:

```typescript
async function retryableRequest(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'RATE_LIMIT_EXCEEDED' && i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000));
      } else {
        throw error;
      }
    }
  }
}
```

### 3. Caching

Cache frequently accessed data:

```typescript
const cache = new Map();

async function getCachedLine(id: string) {
  const cacheKey = `line:${id}`;

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < 60000) {
      // 1 minute TTL
      return cached.data;
    }
  }

  const data = await client.productionLines.get(id);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
```

## Migration Guides

### Migrating from v1 to v2

#### Breaking Changes

1. **Authentication**: OAuth 2.0 replaces API keys
2. **Response Format**: All responses now wrapped in metadata
3. **Endpoint Changes**: `/api/v1/lines` → `/api/v2/production-lines`

#### Migration Steps

```typescript
// v1
const response = await fetch('/api/v1/lines', {
  headers: { 'X-API-Key': 'key' },
});
const lines = await response.json();

// v2
const response = await fetch('/api/v2/production-lines', {
  headers: { Authorization: 'Bearer token' },
});
const { data: lines } = await response.json();
```

## Support

### Documentation

- API Reference: https://docs.ms5.com/api
- Guides: https://docs.ms5.com/guides
- Examples: https://github.com/ms5/examples

### Community

- Discord: https://discord.gg/ms5
- Stack Overflow: [ms5-api] tag
- GitHub Discussions: https://github.com/ms5/discussions

### Contact

- Support: support@ms5.com
- Sales: sales@ms5.com
- Security: security@ms5.com

## Changelog

### v3.0.0 (2024-01-15)

- Added GraphQL Federation support
- WebSocket connection pooling
- Enhanced rate limiting

### v2.5.0 (2023-12-01)

- Introduced webhook system
- Added Python SDK
- Performance improvements

### v2.0.0 (2023-09-15)

- OAuth 2.0 authentication
- GraphQL API
- Breaking changes from v1

For complete changelog: https://docs.ms5.com/changelog
