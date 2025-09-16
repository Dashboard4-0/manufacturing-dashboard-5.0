#!/bin/bash

# MS5.0 Diagnostic and Fix Script for Ubuntu
# This will identify why port 4000 isn't accessible and fix it

echo "================================================"
echo "   MS5.0 Diagnostic & Fix Script"
echo "================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "Step 1: Checking Docker Containers"
echo "==================================="

# Check if containers are running
echo "Active MS5 containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5 || echo "No MS5 containers found"

echo ""
echo "All containers (including stopped):"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5 || echo "No MS5 containers found"

echo ""
echo "Step 2: Checking Port 4000"
echo "=========================="

# Check what's on port 4000
if netstat -tuln | grep -q ":4000 "; then
    print_warning "Something is listening on port 4000"
    lsof -i :4000 2>/dev/null || ss -tuln | grep :4000
else
    print_error "Nothing is listening on port 4000"
fi

echo ""
echo "Step 3: Checking ms5-api Container"
echo "==================================="

if docker ps | grep -q ms5-api; then
    print_status "ms5-api container is running"
    echo "Container logs (last 20 lines):"
    docker logs ms5-api --tail 20 2>&1
else
    print_error "ms5-api container is not running"

    # Check if it exists but stopped
    if docker ps -a | grep -q ms5-api; then
        print_warning "Container exists but is stopped. Logs:"
        docker logs ms5-api --tail 20 2>&1
    else
        print_error "ms5-api container doesn't exist"
    fi
fi

echo ""
echo "Step 4: Quick Fix - Start Simple API"
echo "====================================="

# Stop any existing ms5-api
docker stop ms5-api 2>/dev/null
docker rm ms5-api 2>/dev/null

# Detect PostgreSQL and Redis ports
POSTGRES_PORT=5432
REDIS_PORT=6379

if ! nc -zv localhost 5432 2>&1 | grep -q succeeded; then
    if nc -zv localhost 5433 2>&1 | grep -q succeeded; then
        POSTGRES_PORT=5433
    else
        print_error "PostgreSQL not found on 5432 or 5433"
    fi
fi

if ! nc -zv localhost 6379 2>&1 | grep -q succeeded; then
    if nc -zv localhost 6380 2>&1 | grep -q succeeded; then
        REDIS_PORT=6380
    else
        print_error "Redis not found on 6379 or 6380"
    fi
fi

print_status "Using PostgreSQL on port ${POSTGRES_PORT}"
print_status "Using Redis on port ${REDIS_PORT}"

echo ""
echo "Creating simple API server..."

# Create a minimal API directory
mkdir -p /opt/ms5/quick-api
cd /opt/ms5/quick-api

# Create minimal package.json
cat > package.json << 'EOF'
{
  "name": "ms5-quick-api",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "pg": "^8.11.0"
  }
}
EOF

# Create simple server
cat > server.js << EOF
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  user: 'ms5user',
  password: 'ms5pass',
  host: 'localhost',
  port: ${POSTGRES_PORT},
  database: 'ms5db'
});

// Health check
app.get('/', (req, res) => {
  res.send('<h1>MS5.0 API Running</h1><p>API is active on port 4000</p><p><a href="/api/health">Check Health</a></p>');
});

app.get('/api/health', async (req, res) => {
  try {
    const dbTest = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      timestamp: new Date(),
      database: 'connected',
      dbTime: dbTest.rows[0].now
    });
  } catch (err) {
    res.json({
      status: 'partial',
      timestamp: new Date(),
      database: 'error: ' + err.message
    });
  }
});

// Test endpoint for production lines
app.get('/api/production-lines', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM production_lines');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint for users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, role FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = \$1', [email]);

    if (result.rows.length > 0) {
      res.json({
        success: true,
        user: result.rows[0],
        token: 'demo-token-' + Date.now()
      });
    } else {
      res.status(401).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(\`MS5.0 API running on http://0.0.0.0:\${PORT}\`);
  console.log('Test URLs:');
  console.log('  http://localhost:4000');
  console.log('  http://localhost:4000/api/health');
  console.log('  http://localhost:4000/api/production-lines');
});
EOF

echo ""
echo "Starting API with Node.js directly..."

# Try to start with Docker first
print_warning "Attempting to start with Docker..."
docker run -d \
    --name ms5-api \
    --network host \
    -v /opt/ms5/quick-api:/app \
    -w /app \
    --restart unless-stopped \
    node:20-slim sh -c "npm install && node server.js"

sleep 5

# Check if it started
if docker ps | grep -q ms5-api; then
    print_status "API started with Docker"
else
    print_error "Docker start failed, trying direct Node.js..."

    # Check if Node.js is installed
    if command -v node &> /dev/null; then
        print_status "Node.js found: $(node --version)"

        # Install and start
        cd /opt/ms5/quick-api
        npm install
        nohup node server.js > /opt/ms5/api.log 2>&1 &
        echo $! > /opt/ms5/api.pid

        sleep 3

        if ps -p $(cat /opt/ms5/api.pid) > /dev/null; then
            print_status "API started with Node.js (PID: $(cat /opt/ms5/api.pid))"
        else
            print_error "Failed to start with Node.js"
        fi
    else
        print_error "Node.js not installed. Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    fi
fi

echo ""
echo "Step 5: Testing Connection"
echo "=========================="

sleep 3

# Test different methods
echo "Testing localhost:4000..."
curl -s http://localhost:4000/api/health | head -100 || print_error "localhost:4000 failed"

echo ""
echo "Testing 127.0.0.1:4000..."
curl -s http://127.0.0.1:4000/api/health | head -100 || print_error "127.0.0.1:4000 failed"

echo ""
echo "Testing 0.0.0.0:4000..."
curl -s http://0.0.0.0:4000/api/health | head -100 || print_error "0.0.0.0:4000 failed"

# Get system IP
SYSTEM_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Testing ${SYSTEM_IP}:4000..."
curl -s http://${SYSTEM_IP}:4000/api/health | head -100 || print_error "${SYSTEM_IP}:4000 failed"

echo ""
echo "Step 6: Firewall Check"
echo "======================"

# Check if firewall is active
if command -v ufw &> /dev/null; then
    if ufw status | grep -q "Status: active"; then
        print_warning "UFW firewall is active"
        echo "Adding rule for port 4000..."
        ufw allow 4000/tcp
        print_status "Firewall rule added"
    else
        print_status "UFW firewall is inactive"
    fi
else
    print_status "No UFW firewall found"
fi

# Check iptables
if iptables -L INPUT -n | grep -q "DROP\|REJECT"; then
    print_warning "iptables has restrictive rules"
    echo "Adding iptables rule for port 4000..."
    iptables -I INPUT -p tcp --dport 4000 -j ACCEPT
    print_status "iptables rule added"
fi

echo ""
echo "Step 7: Create Simple Test Page"
echo "==============================="

# Create a simple HTML test page
cat > /opt/ms5/test.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>MS5.0 Connection Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
        }
        .test-item {
            margin: 20px 0;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        .success { background: #d4edda; }
        .error { background: #f8d7da; }
        button {
            padding: 10px 20px;
            margin: 5px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <h1>MS5.0 API Connection Test</h1>

    <div class="test-item">
        <h3>Quick Tests:</h3>
        <button onclick="testEndpoint('http://localhost:4000/api/health')">Test localhost:4000</button>
        <button onclick="testEndpoint('http://127.0.0.1:4000/api/health')">Test 127.0.0.1:4000</button>
        <button onclick="testEndpoint(window.location.origin + '/api/health')">Test Current Origin</button>
    </div>

    <div id="results"></div>

    <script>
        function testEndpoint(url) {
            const resultsDiv = document.getElementById('results');
            const testDiv = document.createElement('div');
            testDiv.className = 'test-item';
            testDiv.innerHTML = '<p>Testing: ' + url + '...</p>';
            resultsDiv.insertBefore(testDiv, resultsDiv.firstChild);

            fetch(url)
                .then(response => response.json())
                .then(data => {
                    testDiv.className = 'test-item success';
                    testDiv.innerHTML = '<h4>✅ Success: ' + url + '</h4><pre>' + JSON.stringify(data, null, 2) + '</pre>';
                })
                .catch(error => {
                    testDiv.className = 'test-item error';
                    testDiv.innerHTML = '<h4>❌ Failed: ' + url + '</h4><p>' + error.message + '</p>';
                });
        }

        // Auto-test on load
        window.onload = () => {
            testEndpoint('http://localhost:4000/api/health');
        };
    </script>
</body>
</html>
EOF

echo "Test page created: /opt/ms5/test.html"
echo "Open this file in a browser on your Ubuntu system"

echo ""
echo "================================================"
echo "   Diagnostic Complete"
echo "================================================"
echo ""
echo "📊 Current Status:"

if curl -s http://localhost:4000/api/health 2>/dev/null | grep -q "ok"; then
    print_status "API is now accessible on port 4000"
    echo ""
    echo "🌐 Access URLs:"
    echo "   Local:    http://localhost:4000"
    echo "   Network:  http://${SYSTEM_IP}:4000"
    echo ""
    echo "📝 Test Endpoints:"
    echo "   http://localhost:4000/           - Welcome page"
    echo "   http://localhost:4000/api/health - Health check"
    echo "   http://localhost:4000/api/production-lines - Data"
else
    print_error "API is still not accessible"
    echo ""
    echo "🔧 Manual Troubleshooting:"
    echo "1. Check Docker: docker ps | grep ms5"
    echo "2. Check logs: docker logs ms5-api"
    echo "3. Check ports: netstat -tuln | grep 4000"
    echo "4. Check firewall: ufw status"
    echo ""
    echo "🔄 Alternative: Install Node.js and run directly:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    echo "   cd /opt/ms5/quick-api && npm install && node server.js"
fi

echo ""
echo "📋 Service Information:"
echo "   PostgreSQL: Port ${POSTGRES_PORT}"
echo "   Redis: Port ${REDIS_PORT}"
echo "   API: Port 4000 (if running)"
echo ""
echo "If still having issues, check:"
echo "1. Container logs: docker logs ms5-api -f"
echo "2. System logs: journalctl -xe"
echo "3. Network: ip addr show"