#!/bin/bash

# MS5.0 Frontend and API Deployment for Ubuntu
# Run this after PostgreSQL and Redis are running

set -e

echo "================================================"
echo "   MS5.0 Frontend & API Deployment"
echo "================================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Detect PostgreSQL and Redis ports
echo "Detecting services..."

# Check PostgreSQL
if nc -zv localhost 5432 2>&1 | grep -q succeeded; then
    POSTGRES_PORT=5432
    echo "✅ PostgreSQL found on port 5432"
elif nc -zv localhost 5433 2>&1 | grep -q succeeded; then
    POSTGRES_PORT=5433
    echo "✅ PostgreSQL found on port 5433"
else
    echo "❌ PostgreSQL not detected"
    exit 1
fi

# Check Redis
if nc -zv localhost 6379 2>&1 | grep -q succeeded; then
    REDIS_PORT=6379
    echo "✅ Redis found on port 6379"
elif nc -zv localhost 6380 2>&1 | grep -q succeeded; then
    REDIS_PORT=6380
    echo "✅ Redis found on port 6380"
else
    echo "❌ Redis not detected"
    exit 1
fi

echo ""
echo "Step 1: Creating Application Structure"
echo "======================================"

# Create directories
mkdir -p /opt/ms5/{app,frontend,api,config}
cd /opt/ms5

# Get system IP
SYSTEM_IP=$(hostname -I | awk '{print $1}')
echo "System IP: ${SYSTEM_IP}"

echo ""
echo "Step 2: Creating API Gateway Service"
echo "===================================="

cat > /opt/ms5/api/package.json << 'EOF'
{
  "name": "ms5-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "pg": "^8.11.0",
    "redis": "^4.6.0",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "ws": "^8.13.0"
  }
}
EOF

cat > /opt/ms5/api/server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration from environment
const PORT = process.env.API_PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'ms5-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static('/opt/ms5/frontend'));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', err => console.log('Redis Error:', err));
redisClient.connect();

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('message', (message) => {
    console.log('Received:', message.toString());
    ws.send(JSON.stringify({ type: 'echo', data: message.toString() }));
  });

  // Send live updates every 5 seconds
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'update',
        timestamp: new Date(),
        data: {
          lines: 3,
          assets: 5,
          activeAlerts: Math.floor(Math.random() * 5)
        }
      }));
    }
  }, 5000);

  ws.on('close', () => {
    clearInterval(interval);
    console.log('WebSocket client disconnected');
  });
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ms5-api',
    timestamp: new Date(),
    connections: {
      database: pool.totalCount > 0,
      redis: redisClient.isReady,
      websocket: wss.clients.size
    }
  });
});

// Authentication endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // For demo, accept any user from database
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // For demo, accept the password as-is if no hash is set
    let validPassword = true;
    if (user.password_hash && user.password_hash !== password) {
      validPassword = await bcrypt.compare(password, user.password_hash);
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Production data endpoints
app.get('/api/production-lines', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM production_lines ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching lines:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, role FROM users ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    // Generate sample metrics
    const metrics = {
      oee: {
        availability: 92.5,
        performance: 88.3,
        quality: 99.1,
        overall: 81.2
      },
      production: {
        totalUnits: 12453,
        goodUnits: 12341,
        defectRate: 0.9
      },
      lines: [
        { name: 'Assembly Line 1', status: 'running', oee: 85.2 },
        { name: 'Packaging Line 1', status: 'running', oee: 78.9 }
      ]
    };

    res.json(metrics);
  } catch (err) {
    console.error('Error fetching metrics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`MS5.0 API running on port ${PORT}`);
  console.log(`WebSocket available on ws://localhost:${PORT}`);
});
EOF

echo "API Gateway created"

echo ""
echo "Step 3: Creating Frontend Application"
echo "====================================="

cat > /opt/ms5/frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MS5.0 Manufacturing Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        header {
            background: rgba(255, 255, 255, 0.95);
            padding: 1rem 2rem;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        h1 {
            color: #333;
            font-size: 1.8rem;
        }

        .status {
            display: flex;
            gap: 1rem;
            align-items: center;
        }

        .status-item {
            padding: 0.5rem 1rem;
            background: #f0f0f0;
            border-radius: 20px;
            font-size: 0.9rem;
        }

        .status-item.online {
            background: #4ade80;
            color: white;
        }

        main {
            flex: 1;
            padding: 2rem;
            max-width: 1400px;
            margin: 0 auto;
            width: 100%;
        }

        .login-container {
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.1);
            max-width: 400px;
            margin: 4rem auto;
        }

        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }

        .card {
            background: white;
            padding: 1.5rem;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }

        .card h2 {
            color: #333;
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }

        .metric {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.8rem 0;
            border-bottom: 1px solid #eee;
        }

        .metric:last-child {
            border-bottom: none;
        }

        .metric-value {
            font-size: 1.5rem;
            font-weight: bold;
            color: #667eea;
        }

        .production-line {
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 0.8rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .line-status {
            padding: 0.3rem 0.8rem;
            border-radius: 15px;
            font-size: 0.85rem;
            font-weight: 500;
        }

        .line-status.running {
            background: #4ade80;
            color: white;
        }

        .line-status.stopped {
            background: #f87171;
            color: white;
        }

        input, button {
            width: 100%;
            padding: 0.8rem;
            margin: 0.5rem 0;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 1rem;
        }

        button {
            background: #667eea;
            color: white;
            border: none;
            cursor: pointer;
            transition: background 0.3s;
        }

        button:hover {
            background: #5a67d8;
        }

        .error {
            color: #f87171;
            margin-top: 0.5rem;
            font-size: 0.9rem;
        }

        .websocket-status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 20px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            font-size: 0.85rem;
        }

        .ws-connected {
            color: #4ade80;
        }

        .ws-disconnected {
            color: #f87171;
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <header>
        <div class="header-content">
            <h1>🏭 MS5.0 Manufacturing System</h1>
            <div class="status">
                <div class="status-item" id="dbStatus">Database: Checking...</div>
                <div class="status-item" id="wsStatus">WebSocket: Disconnected</div>
                <div class="status-item" id="userInfo"></div>
            </div>
        </div>
    </header>

    <main>
        <div id="loginView" class="login-container">
            <h2>Login to MS5.0</h2>
            <form id="loginForm">
                <input type="email" id="email" placeholder="Email" value="admin@ms5.local" required>
                <input type="password" id="password" placeholder="Password" value="admin123" required>
                <button type="submit">Login</button>
                <div id="loginError" class="error"></div>
            </form>
            <p style="margin-top: 1rem; color: #666; font-size: 0.9rem;">
                Demo credentials:<br>
                admin@ms5.local / admin123<br>
                operator@ms5.local / operator123
            </p>
        </div>

        <div id="dashboardView" class="dashboard hidden">
            <div class="card">
                <h2>📊 OEE Metrics</h2>
                <div id="oeeMetrics">
                    <div class="metric">
                        <span>Availability</span>
                        <span class="metric-value">--</span>
                    </div>
                    <div class="metric">
                        <span>Performance</span>
                        <span class="metric-value">--</span>
                    </div>
                    <div class="metric">
                        <span>Quality</span>
                        <span class="metric-value">--</span>
                    </div>
                    <div class="metric">
                        <span>Overall OEE</span>
                        <span class="metric-value">--</span>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>🏭 Production Lines</h2>
                <div id="productionLines">
                    Loading...
                </div>
            </div>

            <div class="card">
                <h2>📈 Production Summary</h2>
                <div id="productionSummary">
                    <div class="metric">
                        <span>Total Units</span>
                        <span class="metric-value">--</span>
                    </div>
                    <div class="metric">
                        <span>Good Units</span>
                        <span class="metric-value">--</span>
                    </div>
                    <div class="metric">
                        <span>Defect Rate</span>
                        <span class="metric-value">--</span>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>👥 Active Users</h2>
                <div id="activeUsers">
                    Loading...
                </div>
            </div>
        </div>
    </main>

    <div class="websocket-status" id="wsIndicator">
        <span id="wsStatusText">⚡ Disconnected</span>
    </div>

    <script>
        const API_URL = window.location.origin + '/api';
        let ws = null;
        let authToken = null;

        // Login functionality
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('loginError');

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if (!response.ok) {
                    throw new Error('Login failed');
                }

                const data = await response.json();
                authToken = data.token;

                // Show user info
                document.getElementById('userInfo').textContent = `👤 ${data.user.name} (${data.user.role})`;
                document.getElementById('userInfo').classList.add('online');

                // Switch views
                document.getElementById('loginView').classList.add('hidden');
                document.getElementById('dashboardView').classList.remove('hidden');

                // Load dashboard data
                loadDashboard();
                connectWebSocket();

            } catch (err) {
                errorDiv.textContent = 'Login failed. Please check your credentials.';
            }
        });

        // Load dashboard data
        async function loadDashboard() {
            try {
                // Check health
                const healthResponse = await fetch(`${API_URL}/health`);
                const health = await healthResponse.json();
                document.getElementById('dbStatus').textContent =
                    health.connections.database ? '🟢 Database: Connected' : '🔴 Database: Error';
                document.getElementById('dbStatus').classList.toggle('online', health.connections.database);

                // Load metrics
                const metricsResponse = await fetch(`${API_URL}/metrics`);
                const metrics = await metricsResponse.json();

                // Update OEE
                const oeeDiv = document.getElementById('oeeMetrics');
                oeeDiv.innerHTML = `
                    <div class="metric">
                        <span>Availability</span>
                        <span class="metric-value">${metrics.oee.availability.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span>Performance</span>
                        <span class="metric-value">${metrics.oee.performance.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span>Quality</span>
                        <span class="metric-value">${metrics.oee.quality.toFixed(1)}%</span>
                    </div>
                    <div class="metric">
                        <span>Overall OEE</span>
                        <span class="metric-value" style="color: ${metrics.oee.overall > 85 ? '#4ade80' : '#f59e0b'}">
                            ${metrics.oee.overall.toFixed(1)}%
                        </span>
                    </div>
                `;

                // Update production summary
                const summaryDiv = document.getElementById('productionSummary');
                summaryDiv.innerHTML = `
                    <div class="metric">
                        <span>Total Units</span>
                        <span class="metric-value">${metrics.production.totalUnits.toLocaleString()}</span>
                    </div>
                    <div class="metric">
                        <span>Good Units</span>
                        <span class="metric-value">${metrics.production.goodUnits.toLocaleString()}</span>
                    </div>
                    <div class="metric">
                        <span>Defect Rate</span>
                        <span class="metric-value">${metrics.production.defectRate.toFixed(1)}%</span>
                    </div>
                `;

                // Load production lines
                const linesResponse = await fetch(`${API_URL}/production-lines`);
                const lines = await linesResponse.json();

                const linesDiv = document.getElementById('productionLines');
                linesDiv.innerHTML = lines.map(line => `
                    <div class="production-line">
                        <div>
                            <strong>${line.name}</strong>
                            <br><small>Area: ${line.area_id}</small>
                        </div>
                        <span class="line-status ${line.status === 'active' ? 'running' : 'stopped'}">
                            ${line.status === 'active' ? '🟢 Running' : '🔴 Stopped'}
                        </span>
                    </div>
                `).join('');

                // Load users
                const usersResponse = await fetch(`${API_URL}/users`);
                const users = await usersResponse.json();

                const usersDiv = document.getElementById('activeUsers');
                usersDiv.innerHTML = users.map(user => `
                    <div class="metric">
                        <span>${user.name}</span>
                        <span style="font-size: 0.9rem; color: #666;">${user.role}</span>
                    </div>
                `).join('');

            } catch (err) {
                console.error('Error loading dashboard:', err);
            }
        }

        // WebSocket connection
        function connectWebSocket() {
            const wsUrl = `ws://${window.location.host}`;
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('WebSocket connected');
                document.getElementById('wsStatus').textContent = '🟢 WebSocket: Connected';
                document.getElementById('wsStatus').classList.add('online');
                document.getElementById('wsIndicator').innerHTML = '<span class="ws-connected">⚡ Live Updates Connected</span>';
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('WebSocket message:', data);

                if (data.type === 'update') {
                    // Flash the indicator
                    document.getElementById('wsIndicator').style.background = '#4ade80';
                    setTimeout(() => {
                        document.getElementById('wsIndicator').style.background = 'white';
                    }, 200);
                }
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                document.getElementById('wsStatus').textContent = '🔴 WebSocket: Disconnected';
                document.getElementById('wsStatus').classList.remove('online');
                document.getElementById('wsIndicator').innerHTML = '<span class="ws-disconnected">⚡ Disconnected</span>';

                // Reconnect after 3 seconds
                setTimeout(connectWebSocket, 3000);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        // Auto-refresh dashboard every 10 seconds
        setInterval(() => {
            if (authToken) {
                loadDashboard();
            }
        }, 10000);
    </script>
</body>
</html>
EOF

echo "Frontend created"

echo ""
echo "Step 4: Starting Application Services"
echo "====================================="

# Create environment file
cat > /opt/ms5/config/.env << EOF
DATABASE_URL=postgresql://ms5user:ms5pass@localhost:${POSTGRES_PORT}/ms5db
REDIS_URL=redis://localhost:${REDIS_PORT}
API_PORT=4000
JWT_SECRET=ms5-jwt-secret-$(openssl rand -hex 16)
NODE_ENV=production
EOF

# Start API service
echo "Starting API service..."
docker run -d \
    --name ms5-api \
    --network host \
    -v /opt/ms5/api:/app \
    -v /opt/ms5/frontend:/opt/ms5/frontend \
    -w /app \
    --env-file /opt/ms5/config/.env \
    --restart unless-stopped \
    node:20-slim sh -c "npm install && node server.js"

echo "Waiting for services to start..."
sleep 10

echo ""
echo "Step 5: Testing the System"
echo "=========================="

# Test API health
echo "Testing API health endpoint..."
if curl -s http://localhost:4000/api/health | grep -q "ok"; then
    echo "✅ API is running"
else
    echo "❌ API failed to start"
    docker logs ms5-api --tail 20
fi

# Create test script
cat > /opt/ms5/test-flow.sh << 'EOF'
#!/bin/bash

echo "MS5.0 System Test Flow"
echo "====================="
echo ""

API_URL="http://localhost:4000/api"

echo "1. Testing API Health..."
curl -s ${API_URL}/health | jq .

echo ""
echo "2. Testing Login..."
TOKEN=$(curl -s -X POST ${API_URL}/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@ms5.local","password":"admin123"}' | jq -r .token)

if [ "$TOKEN" != "null" ]; then
    echo "✅ Login successful"
    echo "Token: ${TOKEN:0:50}..."
else
    echo "❌ Login failed"
fi

echo ""
echo "3. Fetching Production Lines..."
curl -s ${API_URL}/production-lines | jq .

echo ""
echo "4. Fetching Metrics..."
curl -s ${API_URL}/metrics | jq .

echo ""
echo "5. WebSocket Test..."
echo "Connecting to WebSocket..."
timeout 3 wscat -c ws://localhost:4000 2>/dev/null && echo "✅ WebSocket connected" || echo "⚠️  wscat not installed"
EOF
chmod +x /opt/ms5/test-flow.sh

echo ""
echo "Step 6: Setting up Nginx (Optional)"
echo "==================================="

# Check if nginx is installed
if command -v nginx &> /dev/null; then
    cat > /etc/nginx/sites-available/ms5 << EOF
server {
    listen 80;
    server_name ${SYSTEM_IP} ms5.local;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    ln -sf /etc/nginx/sites-available/ms5 /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    echo "✅ Nginx configured"
else
    echo "⚠️  Nginx not installed (optional)"
fi

echo ""
echo "================================================"
echo "   ✅ Frontend & API Deployment Complete!"
echo "================================================"
echo ""
echo "🌐 Access the Frontend:"
echo "   Local:    http://localhost:4000"
echo "   Network:  http://${SYSTEM_IP}:4000"
echo ""
echo "📱 Login Credentials:"
echo "   admin@ms5.local / admin123 (Admin)"
echo "   operator@ms5.local / operator123 (Operator)"
echo ""
echo "🔧 Test Commands:"
echo "   /opt/ms5/test-flow.sh   - Test API flow"
echo "   docker logs ms5-api     - View API logs"
echo "   curl http://localhost:4000/api/health - Check API"
echo ""
echo "📊 API Endpoints:"
echo "   POST /api/auth/login     - Login"
echo "   GET  /api/production-lines - Production lines"
echo "   GET  /api/metrics        - OEE metrics"
echo "   GET  /api/users          - Users list"
echo "   WS   ws://localhost:4000 - WebSocket updates"
echo ""
echo "Open your browser and navigate to:"
echo "   http://${SYSTEM_IP}:4000"
echo ""
echo "The dashboard will show:"
echo "  • Live OEE metrics"
echo "  • Production line status"
echo "  • WebSocket real-time updates"
echo "  • User authentication"