import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const errorRate = new Rate('errors');
const apiResponseTime = new Trend('api_response_time');
const wsConnectionTime = new Trend('ws_connection_time');
const queryResponseTime = new Trend('query_response_time');
const cacheHitRate = new Rate('cache_hits');

// Test configuration
export const options = {
  scenarios: {
    // Scenario 1: Normal load
    normal_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '5m',
      startTime: '0s',
      tags: { scenario: 'normal' }
    },

    // Scenario 2: Peak load
    peak_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '5m', target: 200 },
        { duration: '2m', target: 100 },
        { duration: '1m', target: 0 }
      ],
      startTime: '5m',
      tags: { scenario: 'peak' }
    },

    // Scenario 3: Stress test
    stress_test: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '1m', target: 10 }
      ],
      startTime: '15m',
      tags: { scenario: 'stress' }
    },

    // Scenario 4: WebSocket connections
    websocket_test: {
      executor: 'constant-vus',
      vus: 20,
      duration: '10m',
      startTime: '0s',
      exec: 'websocketScenario',
      tags: { scenario: 'websocket' }
    }
  },

  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'],
    errors: ['rate<0.05'],
    api_response_time: ['p(95)<300'],
    ws_connection_time: ['p(95)<1000'],
    cache_hits: ['rate>0.8']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:4000/ws';

// Test data generators
function generateTelemetryData() {
  return {
    assetId: `asset_${randomIntBetween(1, 100)}`,
    temperature: randomIntBetween(60, 80) + Math.random(),
    pressure: randomIntBetween(95, 105) + Math.random(),
    vibration: randomIntBetween(0, 10) + Math.random(),
    speed: randomIntBetween(1000, 3000),
    timestamp: new Date().toISOString()
  };
}

function generateProductionData() {
  return {
    lineId: `line_${randomIntBetween(1, 10)}`,
    productId: `product_${randomIntBetween(1, 50)}`,
    quantity: randomIntBetween(1, 100),
    quality: randomIntBetween(95, 100) / 100,
    cycleTime: randomIntBetween(30, 120),
    timestamp: new Date().toISOString()
  };
}

function generateAndonCall() {
  return {
    lineId: `line_${randomIntBetween(1, 10)}`,
    stationId: `station_${randomIntBetween(1, 20)}`,
    type: ['QUALITY', 'MAINTENANCE', 'MATERIAL', 'SAFETY'][randomIntBetween(0, 3)],
    priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][randomIntBetween(0, 3)],
    description: `Issue reported at ${new Date().toISOString()}`
  };
}

// Main test scenario
export default function() {
  const testType = randomIntBetween(1, 10);

  // 40% - Read operations
  if (testType <= 4) {
    performReadOperations();
  }
  // 30% - Write operations
  else if (testType <= 7) {
    performWriteOperations();
  }
  // 20% - GraphQL operations
  else if (testType <= 9) {
    performGraphQLOperations();
  }
  // 10% - Complex operations
  else {
    performComplexOperations();
  }

  sleep(randomIntBetween(1, 3));
}

function performReadOperations() {
  const endpoints = [
    '/api/v2/lines',
    '/api/v2/assets',
    '/api/v2/metrics',
    `/api/v2/oee/asset_${randomIntBetween(1, 100)}`,
    `/api/v2/telemetry/asset_${randomIntBetween(1, 100)}/latest`,
    '/api/v2/andon-calls/active',
    '/health'
  ];

  const endpoint = endpoints[randomIntBetween(0, endpoints.length - 1)];
  const start = new Date();

  const response = http.get(`${BASE_URL}${endpoint}`, {
    headers: {
      'Accept': 'application/json',
      'X-API-Version': 'v2'
    }
  });

  const duration = new Date() - start;
  apiResponseTime.add(duration);

  const checks = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
    'has valid JSON': (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    }
  });

  errorRate.add(!checks);

  // Check if response was from cache
  if (response.headers['X-Cache-Status'] === 'HIT') {
    cacheHitRate.add(1);
  } else {
    cacheHitRate.add(0);
  }
}

function performWriteOperations() {
  const operations = [
    () => {
      // Record telemetry
      const data = generateTelemetryData();
      return http.post(`${BASE_URL}/api/v2/telemetry`, JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    },
    () => {
      // Record production data
      const data = generateProductionData();
      return http.post(`${BASE_URL}/api/v2/production`, JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    },
    () => {
      // Create andon call
      const data = generateAndonCall();
      return http.post(`${BASE_URL}/api/v2/andon-calls`, JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    },
    () => {
      // Update asset status
      const assetId = `asset_${randomIntBetween(1, 100)}`;
      const status = ['RUNNING', 'IDLE', 'MAINTENANCE', 'ERROR'][randomIntBetween(0, 3)];
      return http.patch(`${BASE_URL}/api/v2/assets/${assetId}/status`,
        JSON.stringify({ status }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  ];

  const operation = operations[randomIntBetween(0, operations.length - 1)];
  const response = operation();

  check(response, {
    'write successful': (r) => r.status >= 200 && r.status < 300,
    'write response time < 1000ms': (r) => r.timings.duration < 1000
  });
}

function performGraphQLOperations() {
  const queries = [
    {
      query: `
        query GetProductionLines {
          productionLines {
            id
            name
            currentOEE
            assets {
              id
              name
              status
            }
          }
        }
      `
    },
    {
      query: `
        query GetAssetDetails($id: ID!) {
          asset(id: $id) {
            id
            name
            currentOEE
            telemetry(limit: 10) {
              temperature
              pressure
              timestamp
            }
            lossEvents(limit: 5) {
              type
              duration
              reason
            }
          }
        }
      `,
      variables: { id: `asset_${randomIntBetween(1, 100)}` }
    },
    {
      query: `
        mutation RecordLossEvent($input: LossEventInput!) {
          recordLossEvent(input: $input) {
            id
            type
            startTime
            endTime
          }
        }
      `,
      variables: {
        input: {
          assetId: `asset_${randomIntBetween(1, 100)}`,
          type: ['BREAKDOWN', 'CHANGEOVER', 'MINOR_STOP'][randomIntBetween(0, 2)],
          startTime: new Date(Date.now() - 3600000).toISOString(),
          endTime: new Date().toISOString(),
          reason: 'Test loss event'
        }
      }
    }
  ];

  const testQuery = queries[randomIntBetween(0, queries.length - 1)];
  const start = new Date();

  const response = http.post(`${BASE_URL}/graphql`, JSON.stringify(testQuery), {
    headers: { 'Content-Type': 'application/json' }
  });

  const duration = new Date() - start;
  queryResponseTime.add(duration);

  check(response, {
    'GraphQL status OK': (r) => r.status === 200,
    'No GraphQL errors': (r) => {
      const body = JSON.parse(r.body);
      return !body.errors || body.errors.length === 0;
    },
    'GraphQL response time < 800ms': (r) => r.timings.duration < 800
  });
}

function performComplexOperations() {
  // Simulate complex user workflow
  const workflowStart = new Date();

  // Step 1: Get production lines
  let response = http.get(`${BASE_URL}/api/v2/lines`);
  check(response, { 'get lines successful': (r) => r.status === 200 });

  // Step 2: Get assets for a line
  const lineId = `line_${randomIntBetween(1, 10)}`;
  response = http.get(`${BASE_URL}/api/v2/lines/${lineId}/assets`);
  check(response, { 'get assets successful': (r) => r.status === 200 });

  // Step 3: Record telemetry for multiple assets
  const batch = [];
  for (let i = 0; i < 5; i++) {
    batch.push(['POST', `${BASE_URL}/api/v2/telemetry`,
      JSON.stringify(generateTelemetryData()),
      { headers: { 'Content-Type': 'application/json' } }
    ]);
  }

  const responses = http.batch(batch);
  check(responses[0], { 'batch telemetry successful': (r) => r.status < 300 });

  // Step 4: Calculate OEE
  response = http.post(`${BASE_URL}/api/v2/oee/calculate`,
    JSON.stringify({ lineId, period: 'shift' }), {
    headers: { 'Content-Type': 'application/json' }
  });
  check(response, { 'OEE calculation successful': (r) => r.status === 200 });

  const workflowDuration = new Date() - workflowStart;
  check(workflowDuration, {
    'complex workflow < 3s': (d) => d < 3000
  });
}

// WebSocket scenario
export function websocketScenario() {
  const wsStart = new Date();

  const response = ws.connect(WS_URL, null, function(socket) {
    socket.on('open', () => {
      const connectionTime = new Date() - wsStart;
      wsConnectionTime.add(connectionTime);

      // Subscribe to channels
      socket.send(JSON.stringify({
        type: 'subscribe',
        channels: ['telemetry', 'andon', 'oee']
      }));
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        check(message, {
          'valid WebSocket message': (m) => m.type && m.data
        });
      } catch (e) {
        errorRate.add(1);
      }
    });

    socket.on('error', (e) => {
      console.error('WebSocket error:', e);
      errorRate.add(1);
    });

    // Send periodic heartbeat
    socket.setInterval(() => {
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 30000);

    // Simulate real-time data streaming
    socket.setInterval(() => {
      socket.send(JSON.stringify({
        type: 'telemetry',
        data: generateTelemetryData()
      }));
    }, randomIntBetween(1000, 5000));

    // Keep connection open for test duration
    socket.setTimeout(() => {
      socket.close();
    }, 600000); // 10 minutes
  });

  check(response, {
    'WebSocket connection successful': (r) => r && r.status === 101
  });
}

// Export test results handler
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    scenarios: {},
    metrics: {
      requests: {
        total: data.metrics.http_reqs?.values?.count || 0,
        rps: data.metrics.http_reqs?.values?.rate || 0,
        failed: data.metrics.http_req_failed?.values?.passes || 0,
        failureRate: data.metrics.http_req_failed?.values?.rate || 0
      },
      responseTime: {
        min: data.metrics.http_req_duration?.values?.min || 0,
        med: data.metrics.http_req_duration?.values?.med || 0,
        avg: data.metrics.http_req_duration?.values?.avg || 0,
        p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
        p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
        max: data.metrics.http_req_duration?.values?.max || 0
      },
      websockets: {
        connections: data.metrics.ws_sessions?.values?.count || 0,
        connectionTime: {
          avg: data.metrics.ws_connection_time?.values?.avg || 0,
          p95: data.metrics.ws_connection_time?.values?.['p(95)'] || 0
        },
        messagesReceived: data.metrics.ws_msgs_received?.values?.count || 0,
        messagesSent: data.metrics.ws_msgs_sent?.values?.count || 0
      },
      custom: {
        errorRate: data.metrics.errors?.values?.rate || 0,
        cacheHitRate: data.metrics.cache_hits?.values?.rate || 0,
        apiResponseTime: {
          avg: data.metrics.api_response_time?.values?.avg || 0,
          p95: data.metrics.api_response_time?.values?.['p(95)'] || 0
        },
        queryResponseTime: {
          avg: data.metrics.query_response_time?.values?.avg || 0,
          p95: data.metrics.query_response_time?.values?.['p(95)'] || 0
        }
      }
    },
    checks: {
      passes: data.metrics.checks?.values?.passes || 0,
      fails: data.metrics.checks?.values?.fails || 0,
      passRate: (data.metrics.checks?.values?.passes /
                 (data.metrics.checks?.values?.passes + data.metrics.checks?.values?.fails)) || 0
    },
    thresholds: data.thresholds
  };

  return {
    'stdout': JSON.stringify(summary, null, 2),
    'load-test-results.json': JSON.stringify(summary, null, 2)
  };
}