#!/bin/bash

# MS5.0 Manufacturing System - Complete Ubuntu/Jetson Fix
# This script handles ALL port conflicts and installation issues

set -e

echo "================================================"
echo "   MS5.0 Manufacturing System - Ubuntu Fix"
echo "================================================"
echo ""

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Function to check port usage
check_port() {
    local port=$1
    if ss -tuln | grep -q ":$port "; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to find what's using a port
find_port_user() {
    local port=$1
    local service=$(ss -tulpn | grep ":$port " | awk '{print $7}' | cut -d'"' -f2 | head -1)
    echo "$service"
}

check_root

echo "Step 1: Checking current port usage..."
echo "======================================="

# Check PostgreSQL port 5432
if check_port 5432; then
    SERVICE=$(find_port_user 5432)
    echo "❌ Port 5432 is in use by: $SERVICE"
    echo "   Options:"
    echo "   1. Stop the existing service (temporarily)"
    echo "   2. Use alternative port 5433"
    echo ""
    read -p "Choose option (1 or 2): " POSTGRES_CHOICE
else
    echo "✅ Port 5432 is available"
    POSTGRES_CHOICE="0"
fi

# Check Redis port 6379
if check_port 6379; then
    SERVICE=$(find_port_user 6379)
    echo "❌ Port 6379 is in use by: $SERVICE"
    echo "   Options:"
    echo "   1. Stop the existing service (temporarily)"
    echo "   2. Use alternative port 6380"
    echo ""
    read -p "Choose option (1 or 2): " REDIS_CHOICE
else
    echo "✅ Port 6379 is available"
    REDIS_CHOICE="0"
fi

echo ""
echo "Step 2: Stopping existing MS5 containers..."
echo "==========================================="
docker stop ms5-postgres ms5-redis ms5-app 2>/dev/null || true
docker rm ms5-postgres ms5-redis ms5-app 2>/dev/null || true
docker network rm ms5_ms5-network 2>/dev/null || true

# Handle PostgreSQL conflicts
POSTGRES_PORT=5432
if [[ "$POSTGRES_CHOICE" == "1" ]]; then
    echo "Stopping existing PostgreSQL service..."
    systemctl stop postgresql 2>/dev/null || true
    service postgresql stop 2>/dev/null || true
    docker stop $(docker ps -q --filter "publish=5432") 2>/dev/null || true
elif [[ "$POSTGRES_CHOICE" == "2" ]]; then
    POSTGRES_PORT=5433
    echo "Using alternative PostgreSQL port: $POSTGRES_PORT"
fi

# Handle Redis conflicts
REDIS_PORT=6379
if [[ "$REDIS_CHOICE" == "1" ]]; then
    echo "Stopping existing Redis service..."
    systemctl stop redis 2>/dev/null || true
    systemctl stop redis-server 2>/dev/null || true
    service redis stop 2>/dev/null || true
    service redis-server stop 2>/dev/null || true
    docker stop $(docker ps -q --filter "publish=6379") 2>/dev/null || true
elif [[ "$REDIS_CHOICE" == "2" ]]; then
    REDIS_PORT=6380
    echo "Using alternative Redis port: $REDIS_PORT"
fi

echo ""
echo "Step 3: Creating MS5 directory structure..."
echo "==========================================="
mkdir -p /opt/ms5/{app,data,logs,config}
cd /opt/ms5

echo ""
echo "Step 4: Creating fixed Docker Compose configuration..."
echo "======================================================="
cat > /opt/ms5/docker-compose.yml << EOF
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
      - "${POSTGRES_PORT}:5432"
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./config/init.sql:/docker-entrypoint-initdb.d/init.sql
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
      - ./data/redis:/data
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
EOF

echo ""
echo "Step 5: Creating database initialization script..."
echo "=================================================="
cat > /opt/ms5/config/init.sql << 'EOF'
-- MS5.0 Database Initialization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'operator',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default data
INSERT INTO production_lines (name, area_id, status) VALUES
    ('Assembly Line 1', 'AREA-A', 'active'),
    ('Packaging Line 1', 'AREA-B', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO users (email, name, role) VALUES
    ('admin@ms5.local', 'System Admin', 'admin'),
    ('operator@ms5.local', 'Operator', 'operator')
ON CONFLICT DO NOTHING;
EOF

echo ""
echo "Step 6: Creating environment configuration..."
echo "============================================="
cat > /opt/ms5/.env << EOF
# MS5.0 Configuration
DATABASE_URL=postgresql://ms5user:ms5pass@localhost:${POSTGRES_PORT}/ms5db
REDIS_URL=redis://localhost:${REDIS_PORT}
POSTGRES_PORT=${POSTGRES_PORT}
REDIS_PORT=${REDIS_PORT}
API_ENDPOINT=http://$(hostname -I | awk '{print $1}'):4000
NODE_ENV=production
EOF

echo ""
echo "Step 7: Starting services..."
echo "============================"
cd /opt/ms5
docker-compose up -d

echo ""
echo "Step 8: Waiting for services to initialize..."
echo "============================================="
sleep 10

echo ""
echo "Step 9: Verifying services..."
echo "============================="

# Check PostgreSQL
if docker exec ms5-postgres psql -U ms5user -d ms5db -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL is running on port ${POSTGRES_PORT}"
else
    echo "❌ PostgreSQL failed to start"
fi

# Check Redis
if docker exec ms5-redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running on port ${REDIS_PORT}"
else
    echo "❌ Redis failed to start"
fi

echo ""
echo "Step 10: Creating helper commands..."
echo "===================================="

# Create helper scripts
cat > /usr/local/bin/ms5-status << 'EOF'
#!/bin/bash
echo "MS5.0 System Status:"
echo "===================="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5
EOF
chmod +x /usr/local/bin/ms5-status

cat > /usr/local/bin/ms5-logs << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then
    docker-compose -f /opt/ms5/docker-compose.yml logs -f
else
    docker logs -f ms5-$1
fi
EOF
chmod +x /usr/local/bin/ms5-logs

cat > /usr/local/bin/ms5-restart << 'EOF'
#!/bin/bash
cd /opt/ms5
docker-compose restart
EOF
chmod +x /usr/local/bin/ms5-restart

cat > /usr/local/bin/ms5-connect << EOF
#!/bin/bash
docker exec -it ms5-postgres psql -U ms5user -d ms5db
EOF
chmod +x /usr/local/bin/ms5-connect

# Create systemd service for auto-start
cat > /etc/systemd/system/ms5.service << 'EOF'
[Unit]
Description=MS5.0 Manufacturing System
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/ms5
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
StandardOutput=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ms5.service

echo ""
echo "================================================"
echo "   ✅ Installation Complete!"
echo "================================================"
echo ""
echo "Service Status:"
docker-compose -f /opt/ms5/docker-compose.yml ps
echo ""
echo "Access Details:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo "  Database:   ms5db / ms5user / ms5pass"
echo ""
echo "Helper Commands:"
echo "  ms5-status   - Check service status"
echo "  ms5-logs     - View logs"
echo "  ms5-restart  - Restart services"
echo "  ms5-connect  - Connect to PostgreSQL"
echo ""
echo "Services will auto-start on system boot."
echo ""

# Optional: Show how to restore original services
if [[ "$POSTGRES_CHOICE" == "1" ]] || [[ "$REDIS_CHOICE" == "1" ]]; then
    echo "⚠️  Note: You stopped some system services. To restore them:"
    [[ "$POSTGRES_CHOICE" == "1" ]] && echo "  sudo systemctl start postgresql"
    [[ "$REDIS_CHOICE" == "1" ]] && echo "  sudo systemctl start redis-server"
    echo ""
fi