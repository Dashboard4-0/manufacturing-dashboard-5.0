# MS5.0 API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [GraphQL API](#graphql-api)
4. [REST API](#rest-api)
5. [WebSocket API](#websocket-api)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [API Versioning](#api-versioning)

## Overview

The MS5.0 Manufacturing System provides three API interfaces:

- **GraphQL API**: Primary API for complex queries and mutations
- **REST API**: Traditional REST endpoints for simple operations
- **WebSocket API**: Real-time subscriptions and events

### Base URLs

- **Production**: `https://api.ms5.example.com`
- **Staging**: `https://api-staging.ms5.example.com`
- **Development**: `http://localhost:3000`

### API Authentication

All API requests require a valid JWT token in the Authorization header:

```
Authorization: Bearer <jwt-token>
```

## Authentication

### POST /api/auth/login

Authenticate user and receive JWT token.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "refresh_token_here",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "operator",
    "permissions": ["read:production", "execute:andon"]
  },
  "expiresIn": 3600
}
```

### POST /api/auth/refresh

Refresh expired JWT token.

**Request:**

```json
{
  "refreshToken": "refresh_token_here"
}
```

**Response:**

```json
{
  "token": "new_jwt_token",
  "expiresIn": 3600
}
```

### POST /api/auth/logout

Logout and revoke tokens.

**Request:**

```json
{
  "token": "jwt_token",
  "refreshToken": "refresh_token"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /api/auth/me

Get current user information.

**Response:**

```json
{
  "id": "user-123",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "operator",
  "permissions": ["read:production", "execute:andon"],
  "assignedLines": ["line-1", "line-2"],
  "preferences": {
    "theme": "dark",
    "language": "en-GB",
    "notifications": true
  }
}
```

## GraphQL API

### Endpoint

```
POST /graphql
```

### Schema Overview

```graphql
type Query {
  # Production Queries
  productionLines(siteId: ID, areaId: ID, status: LineStatus): [ProductionLine!]!

  productionLine(id: ID!): ProductionLine

  assets(lineId: ID, type: String, status: AssetStatus): [Asset!]!

  # SQDC/DMS Queries
  tierBoards(
    lineId: ID
    boardType: BoardType
    startDate: DateTime
    endDate: DateTime
  ): [TierBoard!]!

  actions(
    boardType: String
    category: String
    status: ActionStatus
    assignedTo: ID
    limit: Int
    offset: Int
  ): [Action!]!

  # Analytics Queries
  oeeMetrics(
    assetId: ID!
    lineId: ID
    startTime: DateTime!
    endTime: DateTime!
    aggregation: AggregationType
  ): OEEMetrics!

  lossEvents(
    assetId: ID
    lineId: ID
    lossType: String
    startTime: DateTime
    endTime: DateTime
    limit: Int
  ): [LossEvent!]!

  paretoAnalysis(
    lineId: ID!
    metric: ParetoMetric!
    startTime: DateTime!
    endTime: DateTime!
  ): [ParetoItem!]!

  # Andon Queries
  andonCalls(lineId: ID, status: AndonStatus, type: AndonType, limit: Int): [AndonCall!]!

  activeAndonCalls: [AndonCall!]!
}

type Mutation {
  # Action Management
  createAction(input: CreateActionInput!): Action!
  updateAction(id: ID!, input: UpdateActionInput!): Action!
  deleteAction(id: ID!): Boolean!

  # Andon System
  triggerAndon(input: TriggerAndonInput!): AndonCall!
  acknowledgeAndon(id: ID!, notes: String): AndonCall!
  resolveAndon(id: ID!, resolution: String!): AndonCall!

  # Production Updates
  updateProductionCount(
    lineId: ID!
    goodCount: Int!
    defectCount: Int
    reworkCount: Int
  ): ProductionUpdate!

  recordDowntime(input: RecordDowntimeInput!): DowntimeEvent!
}

type Subscription {
  # Real-time Updates
  andonTriggered(lineId: ID): AndonCall!
  productionUpdate(lineId: ID!): ProductionUpdate!
  oeeUpdate(assetId: ID!): OEEMetrics!
  actionCreated(boardType: String): Action!
}
```

### Example Queries

#### Get Production Lines with Current OEE

```graphql
query GetProductionLines {
  productionLines(status: RUNNING) {
    id
    name
    status
    currentShift
    currentOEE
    assets {
      id
      name
      status
    }
    activeAndonCalls {
      id
      type
      triggeredAt
    }
  }
}
```

#### Get SQDC Actions

```graphql
query GetActions($status: ActionStatus) {
  actions(boardType: "SQDC", status: $status, limit: 20) {
    id
    boardType
    category
    description
    status
    assignedTo {
      id
      name
    }
    dueDate
    createdAt
    completedAt
  }
}
```

#### Calculate OEE Metrics

```graphql
query GetOEEMetrics($assetId: ID!, $startTime: DateTime!, $endTime: DateTime!) {
  oeeMetrics(assetId: $assetId, startTime: $startTime, endTime: $endTime, aggregation: HOURLY) {
    assetId
    timestamp
    availability
    performance
    quality
    oee
    runtime
    plannedTime
    totalCount
    goodCount
    defectCount
  }
}
```

### Example Mutations

#### Create SQDC Action

```graphql
mutation CreateAction($input: CreateActionInput!) {
  createAction(input: $input) {
    id
    boardType
    category
    description
    status
    assignedTo {
      id
      name
    }
    dueDate
  }
}

variables:
{
  "input": {
    "boardType": "SQDC",
    "category": "QUALITY",
    "description": "Investigate defect rate increase on Line 1",
    "assignedTo": "user-456",
    "dueDate": "2025-01-20T12:00:00Z"
  }
}
```

#### Trigger Andon

```graphql
mutation TriggerAndon($input: TriggerAndonInput!) {
  triggerAndon(input: $input) {
    id
    lineId
    stationId
    type
    status
    triggeredAt
    triggeredBy {
      id
      name
    }
    escalationLevel
  }
}

variables:
{
  "input": {
    "lineId": "line-1",
    "stationId": "station-3",
    "type": "QUALITY",
    "notes": "Product dimension out of specification"
  }
}
```

### Example Subscriptions

#### Subscribe to Andon Triggers

```graphql
subscription OnAndonTriggered($lineId: ID) {
  andonTriggered(lineId: $lineId) {
    id
    lineId
    stationId
    type
    status
    triggeredAt
    triggeredBy {
      name
    }
  }
}
```

#### Subscribe to Production Updates

```graphql
subscription OnProductionUpdate($lineId: ID!) {
  productionUpdate(lineId: $lineId) {
    lineId
    timestamp
    goodCount
    defectCount
    reworkCount
    currentOEE
    targetRate
    actualRate
  }
}
```

## REST API

### Production Endpoints

#### GET /api/production/lines

Get all production lines.

**Query Parameters:**

- `siteId` (optional): Filter by site
- `status` (optional): Filter by status (RUNNING, STOPPED, MAINTENANCE)

**Response:**

```json
{
  "data": [
    {
      "id": "line-1",
      "name": "Assembly Line 1",
      "status": "RUNNING",
      "currentShift": "DAY",
      "currentOEE": 85.4,
      "targetOEE": 85,
      "productionCount": 1250,
      "defectCount": 12
    }
  ],
  "total": 3
}
```

#### GET /api/production/lines/:id

Get specific production line details.

**Response:**

```json
{
  "id": "line-1",
  "name": "Assembly Line 1",
  "status": "RUNNING",
  "currentShift": "DAY",
  "currentOEE": 85.4,
  "assets": [
    {
      "id": "asset-1",
      "name": "Welding Robot 1",
      "status": "ONLINE",
      "utilisation": 92.3
    }
  ],
  "currentProduct": {
    "id": "prod-123",
    "name": "Widget A",
    "targetRate": 100,
    "actualRate": 98
  },
  "metrics": {
    "availability": 95.2,
    "performance": 92.1,
    "quality": 97.5,
    "oee": 85.4
  }
}
```

#### POST /api/production/count

Update production count.

**Request:**

```json
{
  "lineId": "line-1",
  "goodCount": 50,
  "defectCount": 2,
  "reworkCount": 1,
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalCount": 53,
    "goodCount": 50,
    "defectCount": 2,
    "reworkCount": 1,
    "quality": 94.34
  }
}
```

### DMS/SQDC Endpoints

#### GET /api/dms/tier-boards

Get tier boards.

**Query Parameters:**

- `lineId` (optional): Filter by line
- `boardType` (optional): SQDC, TIER1, TIER2, TIER3
- `date` (optional): Specific date (YYYY-MM-DD)

**Response:**

```json
{
  "data": [
    {
      "id": "board-1",
      "lineId": "line-1",
      "boardType": "SQDC",
      "date": "2025-01-15",
      "shift": "DAY",
      "metrics": {
        "safety": { "incidents": 0, "nearMisses": 1 },
        "quality": { "defects": 12, "rework": 3 },
        "delivery": { "onTime": 98.5, "completed": 450 },
        "cost": { "efficiency": 92.3, "waste": 2.1 }
      }
    }
  ]
}
```

#### GET /api/dms/actions

Get SQDC actions.

**Query Parameters:**

- `boardType` (optional): Filter by board type
- `category` (optional): SAFETY, QUALITY, DELIVERY, COST
- `status` (optional): OPEN, IN_PROGRESS, COMPLETED
- `assignedTo` (optional): User ID
- `limit` (default: 20): Number of results
- `offset` (default: 0): Pagination offset

**Response:**

```json
{
  "data": [
    {
      "id": "action-1",
      "boardType": "SQDC",
      "category": "QUALITY",
      "description": "Investigate defect rate",
      "status": "IN_PROGRESS",
      "assignedTo": {
        "id": "user-456",
        "name": "Jane Smith"
      },
      "dueDate": "2025-01-20T12:00:00Z",
      "createdAt": "2025-01-15T08:00:00Z"
    }
  ],
  "total": 45,
  "limit": 20,
  "offset": 0
}
```

#### POST /api/dms/actions

Create new action.

**Request:**

```json
{
  "boardType": "SQDC",
  "category": "SAFETY",
  "description": "Review emergency procedures",
  "assignedTo": "user-789",
  "dueDate": "2025-01-25T17:00:00Z",
  "priority": "HIGH"
}
```

**Response:**

```json
{
  "id": "action-2",
  "boardType": "SQDC",
  "category": "SAFETY",
  "description": "Review emergency procedures",
  "status": "OPEN",
  "assignedTo": "user-789",
  "dueDate": "2025-01-25T17:00:00Z",
  "createdAt": "2025-01-15T10:45:00Z"
}
```

### Analytics Endpoints

#### GET /api/analytics/oee/:assetId

Get OEE metrics for asset.

**Query Parameters:**

- `startTime` (required): ISO 8601 timestamp
- `endTime` (required): ISO 8601 timestamp
- `aggregation` (optional): NONE, HOURLY, DAILY, WEEKLY

**Response:**

```json
{
  "assetId": "asset-1",
  "period": {
    "start": "2025-01-15T00:00:00Z",
    "end": "2025-01-15T23:59:59Z"
  },
  "metrics": {
    "availability": 95.2,
    "performance": 92.1,
    "quality": 97.5,
    "oee": 85.4
  },
  "details": {
    "plannedTime": 480,
    "runtime": 457,
    "downtime": 23,
    "totalCount": 4500,
    "goodCount": 4388,
    "defectCount": 89,
    "reworkCount": 23
  },
  "trend": [
    {
      "timestamp": "2025-01-15T00:00:00Z",
      "oee": 82.3
    },
    {
      "timestamp": "2025-01-15T01:00:00Z",
      "oee": 84.7
    }
  ]
}
```

#### GET /api/analytics/pareto/:lineId

Get Pareto analysis of losses.

**Query Parameters:**

- `metric`: DOWNTIME, DEFECTS, SPEED_LOSS
- `startTime` (required): ISO 8601 timestamp
- `endTime` (required): ISO 8601 timestamp

**Response:**

```json
{
  "lineId": "line-1",
  "metric": "DOWNTIME",
  "period": {
    "start": "2025-01-01T00:00:00Z",
    "end": "2025-01-15T23:59:59Z"
  },
  "items": [
    {
      "category": "Equipment Failure",
      "value": 245,
      "percentage": 35.2,
      "cumulativePercentage": 35.2,
      "count": 12
    },
    {
      "category": "Material Shortage",
      "value": 180,
      "percentage": 25.9,
      "cumulativePercentage": 61.1,
      "count": 8
    },
    {
      "category": "Changeover",
      "value": 120,
      "percentage": 17.2,
      "cumulativePercentage": 78.3,
      "count": 15
    }
  ],
  "total": 695
}
```

### Andon Endpoints

#### POST /api/andon/trigger

Trigger Andon call.

**Request:**

```json
{
  "lineId": "line-1",
  "stationId": "station-3",
  "type": "QUALITY",
  "severity": "HIGH",
  "notes": "Defective component detected"
}
```

**Response:**

```json
{
  "id": "andon-123",
  "lineId": "line-1",
  "stationId": "station-3",
  "type": "QUALITY",
  "status": "TRIGGERED",
  "severity": "HIGH",
  "triggeredBy": {
    "id": "user-123",
    "name": "John Doe"
  },
  "triggeredAt": "2025-01-15T10:45:00Z",
  "escalationLevel": 1,
  "estimatedResponseTime": 120
}
```

#### POST /api/andon/:id/acknowledge

Acknowledge Andon call.

**Request:**

```json
{
  "notes": "On my way to station 3",
  "estimatedResolutionTime": 300
}
```

**Response:**

```json
{
  "id": "andon-123",
  "status": "ACKNOWLEDGED",
  "acknowledgedBy": {
    "id": "user-456",
    "name": "Jane Smith"
  },
  "acknowledgedAt": "2025-01-15T10:47:00Z",
  "responseTimeSeconds": 120
}
```

#### POST /api/andon/:id/resolve

Resolve Andon call.

**Request:**

```json
{
  "resolution": "Replaced defective sensor",
  "rootCause": "Sensor calibration drift",
  "preventiveAction": "Added sensor to daily calibration schedule"
}
```

**Response:**

```json
{
  "id": "andon-123",
  "status": "RESOLVED",
  "resolvedBy": {
    "id": "user-456",
    "name": "Jane Smith"
  },
  "resolvedAt": "2025-01-15T10:55:00Z",
  "resolutionTimeSeconds": 600,
  "resolution": "Replaced defective sensor",
  "rootCause": "Sensor calibration drift"
}
```

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('wss://api.ms5.example.com/ws');

// Authentication
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: 'auth',
      token: 'jwt_token_here',
    }),
  );
};
```

### Subscribe to Events

```javascript
// Subscribe to production updates
ws.send(
  JSON.stringify({
    type: 'subscribe',
    channel: 'production',
    lineId: 'line-1',
  }),
);

// Subscribe to Andon triggers
ws.send(
  JSON.stringify({
    type: 'subscribe',
    channel: 'andon',
    lineId: 'line-1',
  }),
);
```

### Event Messages

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'production_update':
      console.log('Production update:', data.payload);
      break;

    case 'andon_triggered':
      console.log('Andon triggered:', data.payload);
      break;

    case 'oee_update':
      console.log('OEE update:', data.payload);
      break;

    case 'error':
      console.error('WebSocket error:', data.message);
      break;
  }
};
```

### Event Types

#### production_update

```json
{
  "type": "production_update",
  "payload": {
    "lineId": "line-1",
    "timestamp": "2025-01-15T10:45:00Z",
    "goodCount": 1250,
    "defectCount": 12,
    "currentOEE": 85.4,
    "targetRate": 100,
    "actualRate": 98
  }
}
```

#### andon_triggered

```json
{
  "type": "andon_triggered",
  "payload": {
    "id": "andon-123",
    "lineId": "line-1",
    "stationId": "station-3",
    "type": "QUALITY",
    "severity": "HIGH",
    "triggeredAt": "2025-01-15T10:45:00Z"
  }
}
```

#### oee_update

```json
{
  "type": "oee_update",
  "payload": {
    "assetId": "asset-1",
    "timestamp": "2025-01-15T10:45:00Z",
    "availability": 95.2,
    "performance": 92.1,
    "quality": 97.5,
    "oee": 85.4
  }
}
```

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": [
      {
        "field": "lineId",
        "message": "Line ID is required"
      }
    ],
    "timestamp": "2025-01-15T10:45:00Z",
    "correlationId": "req-123456"
  }
}
```

### Error Codes

| Code                | HTTP Status | Description                       |
| ------------------- | ----------- | --------------------------------- |
| UNAUTHORISED        | 401         | Missing or invalid authentication |
| FORBIDDEN           | 403         | Insufficient permissions          |
| NOT_FOUND           | 404         | Resource not found                |
| VALIDATION_ERROR    | 400         | Invalid input parameters          |
| CONFLICT            | 409         | Resource conflict                 |
| RATE_LIMITED        | 429         | Too many requests                 |
| INTERNAL_ERROR      | 500         | Internal server error             |
| SERVICE_UNAVAILABLE | 503         | Service temporarily unavailable   |

### GraphQL Errors

```json
{
  "errors": [
    {
      "message": "Cannot query field 'invalidField' on type 'ProductionLine'",
      "extensions": {
        "code": "GRAPHQL_VALIDATION_FAILED",
        "exception": {
          "stacktrace": [...]
        }
      },
      "locations": [
        {
          "line": 3,
          "column": 5
        }
      ],
      "path": ["productionLines", 0, "invalidField"]
    }
  ],
  "data": null
}
```

## Rate Limiting

### Limits

| Endpoint       | Limit        | Window     |
| -------------- | ------------ | ---------- |
| Authentication | 5 requests   | 15 minutes |
| GraphQL        | 100 requests | 1 minute   |
| REST API       | 100 requests | 1 minute   |
| WebSocket      | 50 messages  | 1 minute   |
| File Upload    | 10 requests  | 1 hour     |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1642248960
Retry-After: 60
```

### Rate Limit Response

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please retry after 60 seconds",
    "retryAfter": 60
  }
}
```

## API Versioning

### Version Header

```
API-Version: 1.0
```

### Deprecation Notice

```
Deprecation: true
Sunset: Sat, 31 Dec 2025 23:59:59 GMT
Link: <https://api.ms5.example.com/v2/docs>; rel="successor-version"
```

### Version Negotiation

```http
GET /api/production/lines HTTP/1.1
Host: api.ms5.example.com
Accept: application/vnd.ms5.v2+json
```

## SDK Examples

### JavaScript/TypeScript

```typescript
import { MS5Client } from '@ms5/sdk';

const client = new MS5Client({
  apiUrl: 'https://api.ms5.example.com',
  token: 'jwt_token_here',
});

// GraphQL query
const lines = await client.graphql.query({
  productionLines: {
    id: true,
    name: true,
    currentOEE: true,
  },
});

// REST API call
const oee = await client.analytics.getOEE('asset-1', {
  startTime: new Date('2025-01-15'),
  endTime: new Date(),
});

// WebSocket subscription
client.ws.subscribe('andon', (event) => {
  console.log('Andon triggered:', event);
});
```

### Python

```python
from ms5_sdk import MS5Client

client = MS5Client(
    api_url='https://api.ms5.example.com',
    token='jwt_token_here'
)

# GraphQL query
lines = client.graphql.query('''
  query {
    productionLines {
      id
      name
      currentOEE
    }
  }
''')

# REST API call
oee = client.analytics.get_oee(
    asset_id='asset-1',
    start_time='2025-01-15T00:00:00Z',
    end_time='2025-01-15T23:59:59Z'
)

# WebSocket subscription
@client.ws.on('andon_triggered')
def handle_andon(event):
    print(f'Andon triggered: {event}')

client.ws.connect()
```

### cURL Examples

```bash
# Authentication
curl -X POST https://api.ms5.example.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# GraphQL query
curl -X POST https://api.ms5.example.com/graphql \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ productionLines { id name currentOEE } }"}'

# REST API
curl https://api.ms5.example.com/api/production/lines \
  -H "Authorization: Bearer $TOKEN"

# WebSocket (using wscat)
wscat -c wss://api.ms5.example.com/ws \
  -H "Authorization: Bearer $TOKEN"
```

## Support

For API support, please contact:

- **Email**: api-support@ms5.example.com
- **Slack**: #ms5-api-support
- **Documentation**: https://docs.ms5.example.com
- **Status Page**: https://status.ms5.example.com
