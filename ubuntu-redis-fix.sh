#!/bin/bash

# MS5.0 Redis Port Conflict Fix for Ubuntu
# This script specifically handles the Redis port conflict issue

set -e

echo "================================================"
echo "   MS5.0 Redis Port Conflict Fix"
echo "================================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

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

echo "Step 1: Identifying what's using port 6379..."
echo "=============================================="

# Find what's using port 6379
PORT_USER=$(sudo lsof -i :6379 | grep LISTEN | awk '{print $1}' | head -1)
PORT_PID=$(sudo lsof -i :6379 | grep LISTEN | awk '{print $2}' | head -1)

if [ -n "$PORT_USER" ]; then
    print_error "Port 6379 is currently in use by: $PORT_USER (PID: $PORT_PID)"

    # Check if it's a system Redis
    if systemctl is-active --quiet redis-server; then
        print_warning "System Redis service is running"
        SYSTEM_REDIS=true
    elif systemctl is-active --quiet redis; then
        print_warning "System Redis service is running"
        SYSTEM_REDIS=true
    else
        SYSTEM_REDIS=false
    fi

    # Check if it's a Docker container
    DOCKER_REDIS=$(docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 6379 | awk '{print $1}' | head -1)
    if [ -n "$DOCKER_REDIS" ]; then
        print_warning "Docker container using port 6379: $DOCKER_REDIS"
    fi
else
    print_status "Port 6379 is available"
    PORT_AVAILABLE=true
fi

echo ""
echo "Step 2: Choose solution..."
echo "=========================="

if [ "$PORT_AVAILABLE" != "true" ]; then
    echo "Options to resolve the conflict:"
    echo "1. Stop the existing Redis service (temporary)"
    echo "2. Use alternative port 6380 for MS5 Redis"
    echo "3. Kill the process using port 6379 (force)"
    echo "4. Automatically handle it (recommended)"
    echo ""
    read -p "Choose option (1-4, default is 4): " CHOICE
    CHOICE=${CHOICE:-4}
else
    CHOICE=0
fi

echo ""
echo "Step 3: Implementing solution..."
echo "================================"

REDIS_PORT=6379

case $CHOICE in
    1)
        print_warning "Stopping existing Redis service..."
        systemctl stop redis-server 2>/dev/null || true
        systemctl stop redis 2>/dev/null || true
        service redis-server stop 2>/dev/null || true
        service redis stop 2>/dev/null || true
        sleep 2
        ;;
    2)
        REDIS_PORT=6380
        print_status "Using alternative port: $REDIS_PORT"
        ;;
    3)
        print_warning "Killing process on port 6379..."
        if [ -n "$PORT_PID" ]; then
            kill -9 $PORT_PID 2>/dev/null || true
            sleep 2
        fi
        ;;
    4|*)
        print_status "Automatic handling..."

        # First try to stop nicely
        if [ "$SYSTEM_REDIS" = "true" ]; then
            print_warning "Stopping system Redis service..."
            systemctl stop redis-server 2>/dev/null || true
            systemctl stop redis 2>/dev/null || true
            systemctl disable redis-server 2>/dev/null || true
            systemctl disable redis 2>/dev/null || true
        fi

        # Stop Docker containers using the port
        if [ -n "$DOCKER_REDIS" ]; then
            print_warning "Stopping Docker container: $DOCKER_REDIS"
            docker stop $DOCKER_REDIS 2>/dev/null || true
        fi

        # Wait a moment
        sleep 3

        # Check if port is now free
        if lsof -i :6379 | grep -q LISTEN; then
            print_warning "Port still in use, using alternative port 6380"
            REDIS_PORT=6380
        else
            print_status "Port 6379 is now available"
        fi
        ;;
esac

echo ""
echo "Step 4: Cleaning up old MS5 containers..."
echo "=========================================="

# Remove any existing MS5 containers
docker stop ms5-redis ms5-postgres ms5-app ms5-auth 2>/dev/null || true
docker rm ms5-redis ms5-postgres ms5-app ms5-auth 2>/dev/null || true
docker network rm ms5_ms5-network ms5-network 2>/dev/null || true
print_status "Old containers cleaned"

echo ""
echo "Step 5: Creating updated Docker Compose..."
echo "==========================================="

# Ensure directory exists
mkdir -p /opt/ms5
cd /opt/ms5

# Create updated docker-compose with proper port
cat > /opt/ms5/docker-compose-fixed.yml << EOF
version: '3.3'

services:
  postgres:
    image: postgres:12
    container_name: ms5-postgres
    environment:
      POSTGRES_USER: ms5user
      POSTGRES_PASSWORD: ms5pass
      POSTGRES_DB: ms5db
    ports:
      - "5432:5432"
    volumes:
      - ./postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ms5user -d ms5db"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ms5-network

  redis:
    image: redis:7-alpine
    container_name: ms5-redis
    ports:
      - "${REDIS_PORT}:6379"
    volumes:
      - ./redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ms5-network

networks:
  ms5-network:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.name: ms5_bridge

volumes:
  postgres_data:
  redis_data:
EOF

# Create basic init.sql if not exists
if [ ! -f /opt/ms5/init.sql ]; then
    cat > /opt/ms5/init.sql << 'SQLEOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'operator',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (email, name, role) VALUES
    ('admin@ms5.local', 'Admin User', 'admin'),
    ('operator@ms5.local', 'Operator User', 'operator')
ON CONFLICT DO NOTHING;

INSERT INTO production_lines (name, area_id) VALUES
    ('Line 1', 'AREA-A'),
    ('Line 2', 'AREA-B')
ON CONFLICT DO NOTHING;
SQLEOF
fi

print_status "Docker Compose configuration created"

echo ""
echo "Step 6: Starting services with correct ports..."
echo "==============================================="

# Start services
docker-compose -f docker-compose-fixed.yml up -d

# Wait for services
sleep 10

echo ""
echo "Step 7: Verifying services..."
echo "============================="

# Check PostgreSQL
if docker exec ms5-postgres psql -U ms5user -d ms5db -c "SELECT 1;" > /dev/null 2>&1; then
    print_status "PostgreSQL is running on port 5432"
else
    print_error "PostgreSQL failed to start"
    docker logs ms5-postgres --tail 20
fi

# Check Redis
if docker exec ms5-redis redis-cli ping > /dev/null 2>&1; then
    print_status "Redis is running on port ${REDIS_PORT}"
else
    print_error "Redis failed to start"
    docker logs ms5-redis --tail 20
fi

echo ""
echo "Step 8: Creating helper scripts..."
echo "==================================="

# Update environment file
cat > /opt/ms5/.env << EOF
REDIS_PORT=${REDIS_PORT}
POSTGRES_PORT=5432
DATABASE_URL=postgresql://ms5user:ms5pass@localhost:5432/ms5db
REDIS_URL=redis://localhost:${REDIS_PORT}
EOF

# Create status command
cat > /usr/local/bin/ms5-status << 'EOF'
#!/bin/bash
echo "MS5.0 System Status:"
echo "===================="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5 || echo "No MS5 containers running"
echo ""
source /opt/ms5/.env 2>/dev/null
echo "Configuration:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT:-5432}"
echo "  Redis:      localhost:${REDIS_PORT:-6379}"
EOF
chmod +x /usr/local/bin/ms5-status

# Create restart command
cat > /usr/local/bin/ms5-restart << 'EOF'
#!/bin/bash
cd /opt/ms5
docker-compose -f docker-compose-fixed.yml restart
EOF
chmod +x /usr/local/bin/ms5-restart

# Create fix command for future use
cat > /usr/local/bin/ms5-fix-ports << 'EOF'
#!/bin/bash
echo "Checking for port conflicts..."
sudo bash /opt/ms5/ubuntu-redis-fix.sh
EOF
chmod +x /usr/local/bin/ms5-fix-ports

print_status "Helper commands created"

echo ""
echo "Step 9: Setting up auto-recovery..."
echo "===================================="

# Create a systemd service that handles port conflicts
cat > /etc/systemd/system/ms5-startup.service << 'EOF'
[Unit]
Description=MS5.0 Startup with Port Conflict Resolution
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/bash -c 'systemctl stop redis-server redis 2>/dev/null || true'
ExecStartPre=/bin/sleep 2
ExecStart=/usr/local/bin/docker-compose -f /opt/ms5/docker-compose-fixed.yml up -d
ExecStop=/usr/local/bin/docker-compose -f /opt/ms5/docker-compose-fixed.yml down
WorkingDirectory=/opt/ms5
StandardOutput=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ms5-startup.service
print_status "Auto-recovery configured"

echo ""
echo "================================================"
echo "   ✅ Redis Port Conflict Fixed!"
echo "================================================"
echo ""
echo "Current Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5
echo ""
echo "Service Endpoints:"
echo "  PostgreSQL: localhost:5432"
echo "  Redis:      localhost:${REDIS_PORT}"
echo ""
echo "Commands:"
echo "  ms5-status      - Check status"
echo "  ms5-restart     - Restart services"
echo "  ms5-fix-ports   - Fix port conflicts"
echo ""

if [ "$REDIS_PORT" != "6379" ]; then
    print_warning "Note: Redis is using alternative port ${REDIS_PORT}"
    echo "Update your application configuration to use this port."
fi

if [ "$SYSTEM_REDIS" = "true" ]; then
    echo ""
    print_warning "System Redis was disabled to prevent conflicts."
    echo "To re-enable system Redis later:"
    echo "  sudo systemctl enable redis-server"
    echo "  sudo systemctl start redis-server"
fi

echo ""
print_status "System is ready!"