import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');
const graphqlLatency = new Trend('graphql_latency');
const websocketLatency = new Trend('websocket_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 100 },  // Ramp up to 100 users
    { duration: '10m', target: 200 }, // Stay at 200 users
    { duration: '5m', target: 500 },  // Spike to 500 users
    { duration: '10m', target: 300 }, // Sustained load at 300 users
    { duration: '5m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% of requests < 500ms
    errors: ['rate<0.05'],                           // Error rate < 5%
    api_latency: ['p(95)<300'],                      // API 95th percentile < 300ms
    graphql_latency: ['p(95)<500'],                  // GraphQL 95th percentile < 500ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Test data
const testUsers = new SharedArray('users', function () {
  return [
    { email: 'operator1@ms5.com', role: 'operator' },
    { email: 'supervisor1@ms5.com', role: 'supervisor' },
    { email: 'manager1@ms5.com', role: 'manager' },
  ];
});

const productionLines = ['line-1', 'line-2', 'line-3'];
const stations = ['station-1', 'station-2', 'station-3', 'station-4'];

export function setup() {
  // Setup test data
  console.log('Setting up test environment...');

  // Create test users and get tokens
  const tokens = {};
  testUsers.forEach(user => {
    const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
      email: user.email,
      password: 'TestPassword123!'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

    if (loginRes.status === 200) {
      tokens[user.role] = JSON.parse(loginRes.body).token;
    }
  });

  return { tokens };
}

export default function (data) {
  const user = testUsers[Math.floor(Math.random() * testUsers.length)];
  const token = data.tokens[user.role];

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  group('Dashboard Operations', () => {
    // Load dashboard
    const dashboardStart = Date.now();
    const dashboardRes = http.get(`${BASE_URL}/api/dashboard`, { headers });
    apiLatency.add(Date.now() - dashboardStart);

    check(dashboardRes, {
      'dashboard status 200': (r) => r.status === 200,
      'dashboard has data': (r) => JSON.parse(r.body).lines !== undefined,
    });

    errorRate.add(dashboardRes.status !== 200);
    sleep(1);
  });

  group('GraphQL Queries', () => {
    const query = `
      query GetProductionMetrics {
        productionLines {
          id
          name
          currentOEE
          currentShift
          activeAlerts {
            id
            severity
            message
          }
        }
        recentActions(limit: 10) {
          id
          boardType
          category
          status
        }
      }
    `;

    const graphqlStart = Date.now();
    const graphqlRes = http.post(`${BASE_URL}/graphql`, JSON.stringify({ query }), { headers });
    graphqlLatency.add(Date.now() - graphqlStart);

    check(graphqlRes, {
      'GraphQL status 200': (r) => r.status === 200,
      'GraphQL no errors': (r) => !JSON.parse(r.body).errors,
    });

    errorRate.add(graphqlRes.status !== 200);
    sleep(1);
  });

  group('SQDC Actions', () => {
    // Create action
    const actionData = {
      boardType: 'SQDC',
      category: ['SAFETY', 'QUALITY', 'DELIVERY', 'COST'][Math.floor(Math.random() * 4)],
      description: `Load test action ${Date.now()}`,
      assignedTo: `user-${Math.floor(Math.random() * 100)}`,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    };

    const createStart = Date.now();
    const createRes = http.post(`${BASE_URL}/api/dms/actions`, JSON.stringify(actionData), { headers });
    apiLatency.add(Date.now() - createStart);

    check(createRes, {
      'create action status 201': (r) => r.status === 201,
      'action has ID': (r) => JSON.parse(r.body).id !== undefined,
    });

    if (createRes.status === 201) {
      const actionId = JSON.parse(createRes.body).id;

      // Update action status
      const updateData = { status: 'IN_PROGRESS' };
      const updateRes = http.patch(`${BASE_URL}/api/dms/actions/${actionId}/status`,
        JSON.stringify(updateData), { headers });

      check(updateRes, {
        'update action status 200': (r) => r.status === 200,
      });
    }

    errorRate.add(createRes.status !== 201);
    sleep(2);
  });

  group('OEE Calculations', () => {
    const line = productionLines[Math.floor(Math.random() * productionLines.length)];

    // Get OEE data
    const oeeStart = Date.now();
    const oeeRes = http.get(`${BASE_URL}/api/loss-analytics/oee/${line}`, { headers });
    apiLatency.add(Date.now() - oeeStart);

    check(oeeRes, {
      'OEE status 200': (r) => r.status === 200,
      'OEE has metrics': (r) => {
        const body = JSON.parse(r.body);
        return body.availability !== undefined &&
               body.performance !== undefined &&
               body.quality !== undefined;
      },
    });

    // Get Pareto analysis
    const paretoRes = http.get(`${BASE_URL}/api/loss-analytics/pareto/${line}`, { headers });

    check(paretoRes, {
      'Pareto status 200': (r) => r.status === 200,
      'Pareto has data': (r) => Array.isArray(JSON.parse(r.body)),
    });

    errorRate.add(oeeRes.status !== 200);
    sleep(1);
  });

  group('Andon System', () => {
    if (user.role === 'operator') {
      const andonData = {
        type: ['QUALITY', 'MAINTENANCE', 'MATERIAL', 'SAFETY'][Math.floor(Math.random() * 4)],
        lineId: productionLines[Math.floor(Math.random() * productionLines.length)],
        stationId: stations[Math.floor(Math.random() * stations.length)],
        description: 'Load test Andon call',
      };

      const andonStart = Date.now();
      const andonRes = http.post(`${BASE_URL}/api/andon/trigger`, JSON.stringify(andonData), { headers });
      apiLatency.add(Date.now() - andonStart);

      check(andonRes, {
        'Andon trigger status 201': (r) => r.status === 201,
        'Andon has call ID': (r) => JSON.parse(r.body).callId !== undefined,
      });

      if (andonRes.status === 201) {
        const callId = JSON.parse(andonRes.body).callId;
        sleep(5); // Simulate response time

        // Cancel Andon
        const cancelRes = http.post(`${BASE_URL}/api/andon/${callId}/cancel`, null, { headers });
        check(cancelRes, {
          'Andon cancel status 200': (r) => r.status === 200,
        });
      }

      errorRate.add(andonRes.status !== 201);
    }
    sleep(3);
  });

  group('Edge Data Ingestion', () => {
    const telemetryData = {
      assetId: `asset-${Math.floor(Math.random() * 10)}`,
      timestamp: new Date().toISOString(),
      metrics: {
        temperature: 20 + Math.random() * 10,
        pressure: 100 + Math.random() * 20,
        vibration: Math.random() * 5,
        speed: 1000 + Math.random() * 500,
      },
      status: Math.random() > 0.1 ? 'RUNNING' : 'STOPPED',
    };

    const telemetryStart = Date.now();
    const telemetryRes = http.post(`${BASE_URL}/api/edge/telemetry`,
      JSON.stringify(telemetryData), { headers });
    apiLatency.add(Date.now() - telemetryStart);

    check(telemetryRes, {
      'telemetry status 202': (r) => r.status === 202,
    });

    errorRate.add(telemetryRes.status !== 202);
    sleep(0.5);
  });

  group('Concurrent Operations', () => {
    const batch = http.batch([
      ['GET', `${BASE_URL}/api/dashboard`, null, { headers }],
      ['GET', `${BASE_URL}/api/dms/actions?limit=10`, null, { headers }],
      ['GET', `${BASE_URL}/api/loss-analytics/trends/weekly`, null, { headers }],
      ['GET', `${BASE_URL}/api/notifications/unread`, null, { headers }],
    ]);

    batch.forEach((res, index) => {
      check(res, {
        [`batch request ${index} status 200`]: (r) => r.status === 200,
      });
      errorRate.add(res.status !== 200);
    });

    sleep(2);
  });
}

export function teardown(data) {
  console.log('Test completed. Cleaning up...');

  // Generate summary report
  const summary = {
    timestamp: new Date().toISOString(),
    errors: errorRate.rate,
    api_p95: apiLatency.percentile(95),
    graphql_p95: graphqlLatency.percentile(95),
    websocket_p95: websocketLatency.percentile(95),
  };

  console.log('Performance Test Summary:', JSON.stringify(summary, null, 2));
}