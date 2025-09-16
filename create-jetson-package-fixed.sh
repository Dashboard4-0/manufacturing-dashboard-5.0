#!/bin/bash

# MS5.0 Complete Jetson Offline Package Creator - FIXED VERSION
# Compatible with Ubuntu 20.04 and docker-compose 1.25

set -e

echo "================================================"
echo "   MS5.0 Jetson Complete Offline Package"
echo "   Building for Recomputer J40 - FIXED"
echo "================================================"

PACKAGE_NAME="ms5-jetson-complete"
BUILD_DIR="$(pwd)/${PACKAGE_NAME}"

# Clean and create structure
rm -rf ${BUILD_DIR}
mkdir -p ${BUILD_DIR}/{app,docker,scripts,config,data,binaries}

# 1. Copy application source
echo "1. Copying application source..."
mkdir -p ${BUILD_DIR}/app
cp -r libs ${BUILD_DIR}/app/ 2>/dev/null || echo "  libs not found, skipping..."
cp -r services ${BUILD_DIR}/app/ 2>/dev/null || echo "  services not found, skipping..."
cp -r apps ${BUILD_DIR}/app/ 2>/dev/null || echo "  apps not found, skipping..."
cp package.json ${BUILD_DIR}/app/ 2>/dev/null || echo "  package.json not found, skipping..."
cp -r docs ${BUILD_DIR}/app/ 2>/dev/null || echo "  docs not found, skipping..."

# 2. Create standalone Node.js bundle
echo "2. Creating Node.js offline bundle..."
cat > ${BUILD_DIR}/app/package.json <<'EOF'
{
  "name": "ms5-manufacturing-system",
  "version": "1.0.0",
  "description": "MS5.0 Manufacturing System",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "4.18.2",
    "pg": "8.11.3",
    "ioredis": "5.3.2",
    "ws": "8.16.0",
    "jsonwebtoken": "9.0.2",
    "bcrypt": "5.1.1",
    "uuid": "9.0.1",
    "winston": "3.11.0",
    "dotenv": "16.3.1",
    "cors": "2.8.5",
    "helmet": "7.1.0",
    "compression": "1.7.4"
  }
}
EOF

# 3. Create Docker compose configuration - FIXED VERSION
echo "3. Creating Docker configuration (compatible version)..."
cat > ${BUILD_DIR}/docker-compose.yml <<'EOF'
version: '3.3'

services:
  postgres:
    image: postgres:12
    container_name: ms5-postgres
    environment:
      POSTGRES_USER: ms5user
      POSTGRES_PASSWORD: ms5secure2025
      POSTGRES_DB: ms5db
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./config/init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    restart: unless-stopped
    networks:
      - ms5-network

  redis:
    image: redis:7-alpine
    container_name: ms5-redis
    volumes:
      - ./data/redis:/data
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 1gb --maxmemory-policy allkeys-lru
    restart: unless-stopped
    networks:
      - ms5-network

  ms5-app:
    image: node:20-slim
    container_name: ms5-app
    working_dir: /app
    depends_on:
      - postgres
      - redis
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ms5db
      DB_USER: ms5user
      DB_PASSWORD: ms5secure2025
      REDIS_HOST: redis
      REDIS_PORT: 6379
      PORT: 4000
    ports:
      - "4000:4000"
      - "3000:3000"
    volumes:
      - ./app:/app
      - ./data/logs:/var/log/ms5
    command: sh -c "cd /app && npm install --production && node index.js"
    restart: unless-stopped
    networks:
      - ms5-network

networks:
  ms5-network:
    driver: bridge
EOF

# 4. Create database initialization SQL
echo "4. Creating database initialization script..."
cat > ${BUILD_DIR}/config/init.sql <<'EOF'
-- MS5.0 Database Schema Initialization

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables
CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'IDLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    line_id UUID REFERENCES production_lines(id),
    type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'IDLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telemetry (
    id SERIAL PRIMARY KEY,
    asset_id UUID REFERENCES assets(id),
    temperature FLOAT,
    pressure FLOAT,
    vibration FLOAT,
    speed INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oee_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id),
    availability FLOAT,
    performance FLOAT,
    quality FLOAT,
    oee FLOAT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'OPERATOR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_telemetry_timestamp ON telemetry(timestamp DESC);
CREATE INDEX idx_telemetry_asset ON telemetry(asset_id, timestamp DESC);
CREATE INDEX idx_oee_timestamp ON oee_metrics(timestamp DESC);
CREATE INDEX idx_oee_asset ON oee_metrics(asset_id, timestamp DESC);

-- Insert default data
INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@ms5.local', '$2b$10$K7L1OJ0TfgK7h3jPdK8jXuNHjLxqv4ZK2H3mKQ2H8nZxKqwKqwKqw', 'ADMIN')
ON CONFLICT (username) DO NOTHING;

INSERT INTO production_lines (name, area_id, status) VALUES
('Assembly Line 1', 'AREA_A', 'RUNNING'),
('Packaging Line 1', 'AREA_B', 'RUNNING'),
('Quality Control', 'AREA_C', 'IDLE')
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ms5user;
EOF

# 5. Create simple Node.js application
echo "5. Creating Node.js application..."
cat > ${BUILD_DIR}/app/index.js <<'EOF'
const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Database connection with retry
const pgPool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'ms5db',
  user: process.env.DB_USER || 'ms5user',
  password: process.env.DB_PASSWORD || 'ms5secure2025',
  max: 20,
  connectionTimeoutMillis: 10000,
});

// Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Wait for database connection
async function waitForDatabase() {
  let retries = 30;
  while (retries > 0) {
    try {
      await pgPool.query('SELECT 1');
      console.log('✅ Database connected');
      return;
    } catch (err) {
      console.log(`Waiting for database... (${retries} retries left)`);
      retries--;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Could not connect to database');
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'MS5.0 Manufacturing System'
  });
});

app.get('/api/v2/metrics', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT COUNT(*) FROM production_lines');
    res.json({
      production_lines: result.rows[0].count,
      status: 'operational',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v2/lines', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM production_lines ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v2/assets', async (req, res) => {
  try {
    const result = await pgPool.query('SELECT * FROM assets ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v2/telemetry', async (req, res) => {
  try {
    const { asset_id, temperature, pressure, vibration, speed } = req.body;
    const result = await pgPool.query(
      'INSERT INTO telemetry (asset_id, temperature, pressure, vibration, speed) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [asset_id, temperature, pressure, vibration, speed]
    );

    // Cache in Redis
    await redis.setex(
      `telemetry:${result.rows[0].id}`,
      300,
      JSON.stringify(req.body)
    );

    res.json({ id: result.rows[0].id, status: 'recorded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
async function start() {
  try {
    await waitForDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════════════════╗
║   MS5.0 Manufacturing System - API Gateway          ║
║   Running on port ${PORT}                               ║
║   Health check: http://localhost:${PORT}/health         ║
╚══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
EOF

# 6. Create FIXED installation script
echo "6. Creating installation script..."
cat > ${BUILD_DIR}/install.sh <<'INSTALLER'
#!/bin/bash

echo "================================================"
echo "   MS5.0 Manufacturing System"
echo "   Offline Installer for Jetson Orin"
echo "================================================"

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then
   echo "Please run with sudo"
   exit 1
fi

# Variables
INSTALL_DIR="/opt/ms5"
DATA_DIR="${INSTALL_DIR}/data"
LOG_DIR="/var/log/ms5"

echo ""
echo "Pre-flight checks..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
else
    echo "✅ Docker found: $(docker --version)"
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install it first."
    echo "   Run: sudo apt-get install docker-compose"
    exit 1
else
    echo "✅ Docker Compose found: $(docker-compose --version)"
fi

# Create directories
echo ""
echo "Creating directories..."
mkdir -p ${INSTALL_DIR}
mkdir -p ${DATA_DIR}/postgres
mkdir -p ${DATA_DIR}/redis
mkdir -p ${DATA_DIR}/logs
mkdir -p ${LOG_DIR}

# Copy files
echo "Installing application..."
cp -r ./* ${INSTALL_DIR}/
chmod -R 755 ${INSTALL_DIR}

# Create ms5 user if not exists
if ! id -u ms5user &>/dev/null; then
    useradd -r -s /bin/false ms5user
    echo "✅ Created ms5user"
fi

# Set permissions
chown -R 999:999 ${DATA_DIR}/postgres  # PostgreSQL user
chown -R 999:999 ${DATA_DIR}/redis     # Redis user
chown -R 1000:1000 ${INSTALL_DIR}/app  # Node user

# Stop any existing containers
echo ""
echo "Stopping any existing containers..."
cd ${INSTALL_DIR}
docker-compose down 2>/dev/null || true

# Load Docker images if they exist
echo ""
if [ -d "docker" ] && [ "$(ls -A docker/*.tar 2>/dev/null)" ]; then
    echo "Loading Docker images..."
    for image in docker/*.tar; do
        echo "Loading $(basename $image .tar)..."
        docker load -i "$image" || echo "  Failed to load $image, will pull if needed"
    done
else
    echo "No offline Docker images found. Docker will pull images (requires internet)."
fi

# Start services
echo ""
echo "Starting services (this may take a few minutes)..."
docker-compose up -d

# Wait for services
echo ""
echo "Waiting for services to initialize..."
sleep 10

# Check if services are running
echo ""
echo "Checking services..."
docker-compose ps

# Create helper scripts
echo ""
echo "Creating helper scripts..."

cat > /usr/local/bin/ms5-status <<'SCRIPT'
#!/bin/bash
echo "MS5.0 System Status"
echo "==================="
cd /opt/ms5 && docker-compose ps
echo ""
echo "Container Logs (last 5 lines):"
echo "------------------------------"
docker logs ms5-postgres 2>&1 | tail -5
docker logs ms5-redis 2>&1 | tail -5
docker logs ms5-app 2>&1 | tail -5
SCRIPT
chmod +x /usr/local/bin/ms5-status

cat > /usr/local/bin/ms5-logs <<'SCRIPT'
#!/bin/bash
SERVICE=${1:-ms5-app}
docker logs -f $SERVICE
SCRIPT
chmod +x /usr/local/bin/ms5-logs

cat > /usr/local/bin/ms5-restart <<'SCRIPT'
#!/bin/bash
cd /opt/ms5 && docker-compose restart
SCRIPT
chmod +x /usr/local/bin/ms5-restart

cat > /usr/local/bin/ms5-test <<'SCRIPT'
#!/bin/bash
echo "Testing MS5.0 API..."
echo ""
echo "1. Health Check:"
curl -s http://localhost:4000/health | python3 -m json.tool
echo ""
echo "2. Metrics:"
curl -s http://localhost:4000/api/v2/metrics | python3 -m json.tool
echo ""
echo "3. Production Lines:"
curl -s http://localhost:4000/api/v2/lines | python3 -m json.tool
SCRIPT
chmod +x /usr/local/bin/ms5-test

# Optimize for Jetson
echo ""
echo "Applying Jetson optimizations..."
if command -v jetson_clocks &> /dev/null; then
    jetson_clocks
    echo "✅ Jetson clocks set to maximum performance"
fi

# Create systemd service
echo "Installing system service..."
cat > /etc/systemd/system/ms5.service <<'SERVICE'
[Unit]
Description=MS5.0 Manufacturing System
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
WorkingDirectory=/opt/ms5
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable ms5

echo ""
echo "================================================"
echo "   Installation Complete!"
echo "================================================"
echo ""
echo "System Information:"
echo "  API Endpoint: http://$(hostname -I | awk '{print $1}'):4000"
echo "  Health Check: http://$(hostname -I | awk '{print $1}'):4000/health"
echo ""
echo "Available Commands:"
echo "  ms5-status    - Check system status"
echo "  ms5-logs      - View logs (ms5-logs [container-name])"
echo "  ms5-restart   - Restart all services"
echo "  ms5-test      - Test API endpoints"
echo ""
echo "Container Names:"
echo "  ms5-postgres  - PostgreSQL database"
echo "  ms5-redis     - Redis cache"
echo "  ms5-app       - Application server"
echo ""
echo "Please wait 30-60 seconds for all services to fully initialize."
echo "Then run: ms5-test"
echo ""
INSTALLER

chmod +x ${BUILD_DIR}/install.sh

# 7. Create uninstall script
cat > ${BUILD_DIR}/uninstall.sh <<'EOF'
#!/bin/bash

echo "Uninstalling MS5.0 Manufacturing System..."

if [ "$EUID" -ne 0 ]; then
   echo "Please run with sudo"
   exit 1
fi

# Stop services
systemctl stop ms5 2>/dev/null
systemctl disable ms5 2>/dev/null
cd /opt/ms5 && docker-compose down -v 2>/dev/null

# Remove containers and images
docker rm -f ms5-postgres ms5-redis ms5-app 2>/dev/null
docker rmi postgres:12 redis:7-alpine node:20-slim 2>/dev/null

# Remove files
rm -rf /opt/ms5
rm -rf /var/log/ms5
rm -f /etc/systemd/system/ms5.service
rm -f /usr/local/bin/ms5-*

echo "Uninstallation complete"
EOF

chmod +x ${BUILD_DIR}/uninstall.sh

# 8. Create Docker image download script
cat > ${BUILD_DIR}/download-images.sh <<'EOF'
#!/bin/bash

echo "Downloading Docker images for offline use..."
echo "This requires internet connection!"
echo ""

mkdir -p docker

# Pull and save images
echo "1. Pulling PostgreSQL 12..."
docker pull postgres:12
docker save postgres:12 > docker/postgres.tar

echo "2. Pulling Redis..."
docker pull redis:7-alpine
docker save redis:7-alpine > docker/redis.tar

echo "3. Pulling Node.js..."
docker pull node:20-slim
docker save node:20-slim > docker/node.tar

echo ""
echo "Docker images saved to docker/ directory"
echo "Total size: $(du -sh docker | cut -f1)"
EOF

chmod +x ${BUILD_DIR}/download-images.sh

# 9. Create README
cat > ${BUILD_DIR}/README.md <<'EOF'
# MS5.0 Manufacturing System - Jetson Offline Installation

## Quick Start

### On a machine with internet:
```bash
# Download Docker images for offline use
./download-images.sh
```

### On your Jetson (offline):
```bash
# Install
sudo ./install.sh

# Wait 60 seconds, then test
ms5-test
```

## Troubleshooting

### If you get "version unsupported" error:
The docker-compose.yml uses version 3.3 which is compatible with docker-compose 1.25

### If database connection fails:
1. Check if PostgreSQL container is running:
   ```bash
   docker ps | grep postgres
   ```

2. Check PostgreSQL logs:
   ```bash
   docker logs ms5-postgres
   ```

3. Restart services:
   ```bash
   cd /opt/ms5
   docker-compose down
   docker-compose up -d
   ```

### Test the API:
```bash
# Health check
curl http://localhost:4000/health

# Get metrics
curl http://localhost:4000/api/v2/metrics
```

## System Requirements
- Docker 20.10+
- Docker Compose 1.25+
- 4GB RAM minimum
- 10GB disk space

## Support Commands
- `ms5-status` - Check all services
- `ms5-logs [service]` - View logs
- `ms5-restart` - Restart all services
- `ms5-test` - Test API endpoints
EOF

echo ""
echo "================================================"
echo "   Package Build Complete!"
echo "================================================"
echo ""
echo "Directory created: ${PACKAGE_NAME}/"
echo ""
echo "Next steps:"
echo "1. Run ./download-images.sh (on machine with internet)"
echo "2. Copy entire folder to Jetson"
echo "3. Run sudo ./install.sh on Jetson"
echo ""