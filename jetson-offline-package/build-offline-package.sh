#!/bin/bash

# MS5.0 Jetson Offline Package Builder
# This script builds a complete offline installation package for Jetson Orin

set -e

echo "================================================"
echo "   MS5.0 Jetson Offline Package Builder"
echo "   Target: NVIDIA Jetson Orin (ARM64)"
echo "================================================"

# Configuration
PACKAGE_DIR="ms5-jetson-offline"
BUILD_DIR="$(pwd)/${PACKAGE_DIR}"
DOCKER_IMAGES_DIR="${BUILD_DIR}/docker-images"
NODE_MODULES_DIR="${BUILD_DIR}/node_modules_offline"
BINARIES_DIR="${BUILD_DIR}/binaries"
SERVICES_DIR="${BUILD_DIR}/services"
CONFIG_DIR="${BUILD_DIR}/config"
SCRIPTS_DIR="${BUILD_DIR}/scripts"
DATA_DIR="${BUILD_DIR}/data"

# Create directory structure
echo "Creating package structure..."
mkdir -p ${DOCKER_IMAGES_DIR}
mkdir -p ${NODE_MODULES_DIR}
mkdir -p ${BINARIES_DIR}
mkdir -p ${SERVICES_DIR}
mkdir -p ${CONFIG_DIR}
mkdir -p ${SCRIPTS_DIR}
mkdir -p ${DATA_DIR}

# 1. Build ARM64 Docker Images
echo ""
echo "=== Building ARM64 Docker Images ==="

# Create multi-arch Dockerfile for the main application
cat > ${BUILD_DIR}/Dockerfile.jetson <<'EOF'
# MS5.0 Manufacturing System - Jetson Optimized
FROM arm64v8/node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ postgresql-client

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./
COPY tsconfig*.json ./

# Copy source code
COPY apps ./apps
COPY libs ./libs
COPY services ./services

# Install pnpm
RUN npm install -g pnpm@8.15.0

# Install dependencies (offline mode will be configured)
RUN pnpm install --frozen-lockfile

# Build the application
RUN pnpm build

# Production stage
FROM arm64v8/node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache postgresql-client redis

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create non-root user
RUN addgroup -g 1001 ms5user && \
    adduser -u 1001 -G ms5user -s /bin/sh -D ms5user && \
    chown -R ms5user:ms5user /app

USER ms5user

EXPOSE 4000 3000

CMD ["node", "dist/services/ms5.0-gateway/src/index.js"]
EOF

# Create PostgreSQL ARM64 optimized configuration
cat > ${CONFIG_DIR}/postgresql-jetson.conf <<'EOF'
# PostgreSQL Configuration for Jetson Orin
# Optimized for 15GB RAM, ARM64

# Memory Settings (for 15GB total RAM)
shared_buffers = 3GB
effective_cache_size = 10GB
maintenance_work_mem = 768MB
work_mem = 32MB
wal_buffers = 16MB

# Connection Settings
max_connections = 200
superuser_reserved_connections = 3

# Write Performance
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
min_wal_size = 1GB
max_wal_size = 4GB

# ARM64 Optimizations
jit = off  # JIT can cause issues on ARM
huge_pages = off

# Parallel Processing (4 cores)
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
max_parallel_maintenance_workers = 2

# Logging
logging_collector = on
log_directory = '/var/log/postgresql'
log_filename = 'postgresql-%Y-%m-%d.log'
log_rotation_age = 1d
log_rotation_size = 100MB
EOF

# Create Redis ARM64 configuration
cat > ${CONFIG_DIR}/redis-jetson.conf <<'EOF'
# Redis Configuration for Jetson Orin

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Persistence
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300

# ARM64 optimizations
io-threads 4
io-threads-do-reads yes

# Append only file
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
EOF

# 2. Create Installation Scripts
echo "Creating installation scripts..."

# Main installation script
cat > ${SCRIPTS_DIR}/install.sh <<'INSTALL_SCRIPT'
#!/bin/bash

# MS5.0 Jetson Installation Script
# Run with sudo

set -e

echo "================================================"
echo "   MS5.0 Manufacturing System Installer"
echo "   For NVIDIA Jetson Orin (Offline)"
echo "================================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
   echo "Please run with sudo"
   exit 1
fi

# Configuration
INSTALL_DIR="/opt/ms5"
DATA_DIR="/var/lib/ms5"
LOG_DIR="/var/log/ms5"
CONFIG_DIR="/etc/ms5"

# Create directories
echo "Creating directories..."
mkdir -p ${INSTALL_DIR}
mkdir -p ${DATA_DIR}
mkdir -p ${LOG_DIR}
mkdir -p ${CONFIG_DIR}

# Stop any existing services
echo "Stopping existing services..."
systemctl stop ms5-gateway 2>/dev/null || true
systemctl stop ms5-worker 2>/dev/null || true

# 1. Load Docker images
echo ""
echo "Loading Docker images..."
for image in docker-images/*.tar; do
    echo "Loading $(basename $image)..."
    docker load -i $image
done

# 2. Setup PostgreSQL
echo ""
echo "Setting up PostgreSQL..."
if ! systemctl is-active --quiet postgresql; then
    systemctl start postgresql
    systemctl enable postgresql
fi

# Create database and user
sudo -u postgres psql <<EOF
CREATE USER ms5user WITH PASSWORD 'ms5secure2025';
CREATE DATABASE ms5db OWNER ms5user;
CREATE DATABASE ms5db_replica OWNER ms5user;
GRANT ALL PRIVILEGES ON DATABASE ms5db TO ms5user;
GRANT ALL PRIVILEGES ON DATABASE ms5db_replica TO ms5user;
EOF

# Apply optimized configuration
cp config/postgresql-jetson.conf /etc/postgresql/12/main/postgresql.conf
systemctl restart postgresql

# 3. Setup Redis
echo ""
echo "Setting up Redis..."
if ! command -v redis-server &> /dev/null; then
    # Install Redis from bundled deb files
    dpkg -i binaries/redis*.deb
fi

cp config/redis-jetson.conf /etc/redis/redis.conf
systemctl restart redis-server
systemctl enable redis-server

# 4. Install Node.js application
echo ""
echo "Installing MS5.0 application..."
cp -r services/* ${INSTALL_DIR}/
cp -r node_modules_offline ${INSTALL_DIR}/node_modules

# 5. Setup environment
echo ""
echo "Configuring environment..."
cat > ${CONFIG_DIR}/ms5.env <<'ENV'
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ms5db
DB_USER=ms5user
DB_PASSWORD=ms5secure2025

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Application
PORT=4000
GATEWAY_PORT=4000
WORKER_PORT=4001

# Jetson Optimizations
UV_THREADPOOL_SIZE=8
NODE_OPTIONS="--max-old-space-size=4096"

# Features
ENABLE_GPU_ACCELERATION=true
JETSON_POWER_MODE=MAXN
ENV
chmod 600 ${CONFIG_DIR}/ms5.env

# 6. Install systemd services
echo ""
echo "Installing system services..."
cp scripts/systemd/*.service /etc/systemd/system/
systemctl daemon-reload

# 7. Initialize database
echo ""
echo "Initializing database..."
cd ${INSTALL_DIR}
export $(cat ${CONFIG_DIR}/ms5.env | xargs)
node scripts/init-db.js

# 8. Start services
echo ""
echo "Starting services..."
systemctl start ms5-gateway
systemctl enable ms5-gateway
systemctl start ms5-worker
systemctl enable ms5-worker

# 9. Setup Jetson-specific optimizations
echo ""
echo "Applying Jetson optimizations..."

# Set Jetson to max performance
if command -v jetson_clocks &> /dev/null; then
    jetson_clocks --fan
    echo "Jetson clocks set to maximum performance"
fi

# Enable persistent mode for GPU
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi -pm 1
fi

# 10. Setup nginx reverse proxy
echo ""
echo "Setting up Nginx..."
cat > /etc/nginx/sites-available/ms5 <<'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/ms5 /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "================================================"
echo "   Installation Complete!"
echo "================================================"
echo ""
echo "Access the system at:"
echo "  Web Interface: http://$(hostname -I | cut -d' ' -f1)"
echo "  API Gateway: http://$(hostname -I | cut -d' ' -f1)/api"
echo ""
echo "Default credentials:"
echo "  Username: admin"
echo "  Password: ms5admin2025"
echo ""
echo "Services status:"
systemctl status ms5-gateway --no-pager | head -n 3
systemctl status ms5-worker --no-pager | head -n 3
echo ""
echo "Logs available at: ${LOG_DIR}"
echo ""
INSTALL_SCRIPT

chmod +x ${SCRIPTS_DIR}/install.sh

# Create systemd service files
echo "Creating systemd services..."

# Gateway service
cat > ${SCRIPTS_DIR}/systemd/ms5-gateway.service <<'EOF'
[Unit]
Description=MS5.0 Manufacturing System Gateway
After=network.target postgresql.service redis.service
Requires=postgresql.service redis.service

[Service]
Type=simple
User=ms5user
Group=ms5user
WorkingDirectory=/opt/ms5
EnvironmentFile=/etc/ms5/ms5.env
ExecStart=/usr/bin/node /opt/ms5/gateway/index.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ms5/gateway.log
StandardError=append:/var/log/ms5/gateway.error.log

# Jetson optimizations
CPUAffinity=0-3
Nice=-5

[Install]
WantedBy=multi-user.target
EOF

# Worker service
cat > ${SCRIPTS_DIR}/systemd/ms5-worker.service <<'EOF'
[Unit]
Description=MS5.0 Manufacturing System Worker
After=network.target postgresql.service redis.service ms5-gateway.service
Requires=postgresql.service redis.service

[Service]
Type=simple
User=ms5user
Group=ms5user
WorkingDirectory=/opt/ms5
EnvironmentFile=/etc/ms5/ms5.env
ExecStart=/usr/bin/node /opt/ms5/worker/index.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/ms5/worker.log
StandardError=append:/var/log/ms5/worker.error.log

# Jetson optimizations
CPUAffinity=0-3
Nice=-5

[Install]
WantedBy=multi-user.target
EOF

# 3. Bundle Node modules for offline installation
echo ""
echo "=== Bundling Node.js dependencies ==="

# Create package.json for offline bundle
cat > ${NODE_MODULES_DIR}/package.json <<'EOF'
{
  "name": "ms5-dependencies",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2",
    "fastify": "^4.26.0",
    "@apollo/server": "^4.10.0",
    "graphql": "^16.8.1",
    "pg": "^8.11.3",
    "ioredis": "^5.3.2",
    "ws": "^8.16.0",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "uuid": "^9.0.1",
    "winston": "^3.11.0",
    "pino": "^8.17.2",
    "bullmq": "^5.1.0",
    "@prisma/client": "^5.8.0",
    "kafkajs": "^2.2.4",
    "mqtt": "^5.3.4",
    "node-opcua": "^2.121.0",
    "multer": "^1.4.5-lts.1",
    "@aws-sdk/client-s3": "^3.490.0",
    "node-cron": "^3.0.3",
    "axios": "^1.6.5",
    "dotenv": "^16.3.1",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "compression": "^1.7.4",
    "express-rate-limit": "^7.1.5"
  }
}
EOF

echo "Downloading npm packages for offline installation..."
cd ${NODE_MODULES_DIR}
npm install --legacy-peer-deps --production
cd -

# 4. Create database initialization script
cat > ${SCRIPTS_DIR}/init-db.js <<'EOF'
// MS5.0 Database Initialization Script
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function initDatabase() {
  console.log('Initializing MS5.0 database schema...');

  try {
    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS production_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        area_id VARCHAR(100),
        status VARCHAR(50) DEFAULT 'IDLE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        line_id UUID REFERENCES production_lines(id),
        type VARCHAR(100),
        status VARCHAR(50) DEFAULT 'IDLE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_id UUID REFERENCES assets(id),
        temperature FLOAT,
        pressure FLOAT,
        vibration FLOAT,
        speed INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS oee_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_id UUID REFERENCES assets(id),
        availability FLOAT,
        performance FLOAT,
        quality FLOAT,
        oee FLOAT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    `);

    // Insert default admin user
    await pool.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@ms5.local', '$2b$10$YourHashedPasswordHere', 'ADMIN')
      ON CONFLICT (username) DO NOTHING;
    `);

    console.log('Database initialization complete!');
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
EOF

# 5. Create health check script
cat > ${SCRIPTS_DIR}/health-check.sh <<'EOF'
#!/bin/bash

echo "MS5.0 System Health Check"
echo "========================="

# Check services
echo ""
echo "Service Status:"
systemctl is-active ms5-gateway >/dev/null && echo "✓ Gateway: Running" || echo "✗ Gateway: Stopped"
systemctl is-active ms5-worker >/dev/null && echo "✓ Worker: Running" || echo "✗ Worker: Stopped"
systemctl is-active postgresql >/dev/null && echo "✓ PostgreSQL: Running" || echo "✗ PostgreSQL: Stopped"
systemctl is-active redis-server >/dev/null && echo "✓ Redis: Running" || echo "✗ Redis: Stopped"

# Check ports
echo ""
echo "Port Status:"
netstat -tuln | grep -q ":4000" && echo "✓ API Gateway (4000): Listening" || echo "✗ API Gateway (4000): Not listening"
netstat -tuln | grep -q ":3000" && echo "✓ Web UI (3000): Listening" || echo "✗ Web UI (3000): Not listening"
netstat -tuln | grep -q ":5432" && echo "✓ PostgreSQL (5432): Listening" || echo "✗ PostgreSQL (5432): Not listening"
netstat -tuln | grep -q ":6379" && echo "✓ Redis (6379): Listening" || echo "✗ Redis (6379): Not listening"

# Check disk space
echo ""
echo "Disk Usage:"
df -h / | tail -1 | awk '{print "Root: " $5 " used (" $4 " available)"}'

# Check memory
echo ""
echo "Memory Usage:"
free -h | grep Mem | awk '{print "Memory: " $3 " / " $2 " (" $7 " available)"}'

# Check Jetson status
if command -v tegrastats &> /dev/null; then
    echo ""
    echo "Jetson Status:"
    timeout 1 tegrastats | head -1
fi

echo ""
echo "Logs: /var/log/ms5/"
EOF

chmod +x ${SCRIPTS_DIR}/health-check.sh

# 6. Build Docker images
echo ""
echo "=== Building Docker images ==="

# Build main application image
docker build -t ms5/gateway:jetson -f ${BUILD_DIR}/Dockerfile.jetson .
docker save -o ${DOCKER_IMAGES_DIR}/ms5-gateway.tar ms5/gateway:jetson

# Pull and save essential ARM64 images
docker pull --platform linux/arm64 postgres:15-alpine
docker save -o ${DOCKER_IMAGES_DIR}/postgres.tar postgres:15-alpine

docker pull --platform linux/arm64 redis:7-alpine
docker save -o ${DOCKER_IMAGES_DIR}/redis.tar redis:7-alpine

docker pull --platform linux/arm64 nginx:alpine
docker save -o ${DOCKER_IMAGES_DIR}/nginx.tar nginx:alpine

# 7. Copy application code
echo ""
echo "=== Copying application code ==="
mkdir -p ${SERVICES_DIR}/gateway
mkdir -p ${SERVICES_DIR}/worker

# Build the application first
pnpm build

# Copy built files
cp -r dist/services/ms5.0-gateway/* ${SERVICES_DIR}/gateway/
cp -r dist/libs/shared ${SERVICES_DIR}/shared

# Copy essential files
cp package.json ${BUILD_DIR}/
cp pnpm-workspace.yaml ${BUILD_DIR}/
cp -r docs ${BUILD_DIR}/

# 8. Create README
cat > ${BUILD_DIR}/README.md <<'EOF'
# MS5.0 Manufacturing System - Jetson Offline Package

## System Requirements
- NVIDIA Jetson Orin (or compatible)
- Ubuntu 20.04 LTS
- 15GB+ RAM
- 50GB+ available disk space
- ARM64 architecture

## Installation

1. Extract the package:
```bash
tar -xzf ms5-jetson-offline.tar.gz
cd ms5-jetson-offline
```

2. Run the installer:
```bash
sudo ./scripts/install.sh
```

3. Verify installation:
```bash
./scripts/health-check.sh
```

## Access Points
- Web Interface: http://[jetson-ip]
- API Gateway: http://[jetson-ip]:4000
- GraphQL Playground: http://[jetson-ip]:4000/graphql

## Default Credentials
- Username: admin
- Password: ms5admin2025

## Services
- ms5-gateway: Main API gateway
- ms5-worker: Background worker
- PostgreSQL: Database
- Redis: Cache and queue

## Commands
```bash
# Check status
sudo systemctl status ms5-gateway
sudo systemctl status ms5-worker

# View logs
sudo journalctl -u ms5-gateway -f
sudo tail -f /var/log/ms5/gateway.log

# Restart services
sudo systemctl restart ms5-gateway
sudo systemctl restart ms5-worker
```

## Jetson Optimization
The system is optimized for Jetson with:
- CPU affinity settings
- Memory limits configured for 15GB RAM
- GPU acceleration enabled (where applicable)
- Power mode set to MAXN for maximum performance

## Troubleshooting
1. Run health check: `./scripts/health-check.sh`
2. Check logs: `/var/log/ms5/`
3. Verify ports: `sudo netstat -tuln`
4. Check disk space: `df -h`

## Support
Documentation available in `/opt/ms5/docs/`
EOF

# 9. Create compression script
cat > ${BUILD_DIR}/compress.sh <<'EOF'
#!/bin/bash
echo "Compressing MS5.0 Jetson package..."
cd ..
tar -czf ms5-jetson-offline.tar.gz ms5-jetson-offline/
echo "Package created: ms5-jetson-offline.tar.gz"
echo "Size: $(du -h ms5-jetson-offline.tar.gz | cut -f1)"
echo ""
echo "Transfer this file to your Jetson and extract with:"
echo "  tar -xzf ms5-jetson-offline.tar.gz"
echo "  cd ms5-jetson-offline"
echo "  sudo ./scripts/install.sh"
EOF

chmod +x ${BUILD_DIR}/compress.sh

echo ""
echo "================================================"
echo "   Build Complete!"
echo "================================================"
echo ""
echo "Package created in: ${BUILD_DIR}"
echo ""
echo "To compress for transfer:"
echo "  cd ${PACKAGE_DIR}"
echo "  ./compress.sh"
echo ""
echo "The compressed package will include:"
echo "  - ARM64 Docker images"
echo "  - Node.js dependencies"
echo "  - PostgreSQL & Redis configs"
echo "  - Installation scripts"
echo "  - System services"
echo "  - Documentation"
echo ""
echo "Total uncompressed size: $(du -sh ${BUILD_DIR} | cut -f1)"
echo ""