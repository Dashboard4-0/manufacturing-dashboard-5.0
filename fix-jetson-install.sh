#!/bin/bash

# MS5.0 Manufacturing System - Fixed Jetson Installation Script
# This version handles port conflicts properly

set -e

echo "================================================"
echo "   MS5.0 Manufacturing System - Jetson Fix"
echo "================================================"
echo ""

# Function to check if port is in use
check_port() {
    local port=$1
    if netstat -tuln | grep -q ":$port "; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Check for port conflicts on Jetson device
echo "Checking for port conflicts..."

POSTGRES_PORT=5432
REDIS_PORT=6379
APP_PORT=4000

# Check PostgreSQL port
if check_port $POSTGRES_PORT; then
    echo "⚠️  Port $POSTGRES_PORT is already in use"
    POSTGRES_PORT=5433
    echo "   Using alternative port: $POSTGRES_PORT"
else
    echo "✅ Port $POSTGRES_PORT is available"
fi

# Check Redis port
if check_port $REDIS_PORT; then
    echo "⚠️  Port $REDIS_PORT is already in use"
    REDIS_PORT=6380
    echo "   Using alternative port: $REDIS_PORT"
else
    echo "✅ Port $REDIS_PORT is available"
fi

# Check App port
if check_port $APP_PORT; then
    echo "⚠️  Port $APP_PORT is already in use"
    APP_PORT=4001
    echo "   Using alternative port: $APP_PORT"
else
    echo "✅ Port $APP_PORT is available"
fi

echo ""
echo "Stopping any existing MS5 containers..."
docker stop ms5-postgres ms5-redis ms5-app 2>/dev/null || true
docker rm ms5-postgres ms5-redis ms5-app 2>/dev/null || true

# Create updated docker-compose file with correct ports
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
      - "${POSTGRES_PORT}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ms5user -d ms5db"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ms5-network

  redis:
    image: redis:7-alpine
    container_name: ms5-redis
    ports:
      - "${REDIS_PORT}:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - ms5-network

  app:
    image: node:20-slim
    container_name: ms5-app
    working_dir: /app
    volumes:
      - ./app:/app
    ports:
      - "${APP_PORT}:4000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://ms5user:ms5pass@postgres:5432/ms5db
      REDIS_URL: redis://redis:6379
      PORT: 4000
    command: >
      sh -c "
      cd /app &&
      npm install --production &&
      node index.js
      "
    depends_on:
      - postgres
      - redis
    networks:
      - ms5-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  postgres_data:
  redis_data:

networks:
  ms5-network:
    driver: bridge
EOF

# Update environment variables
cat > /opt/ms5/.env << EOF
# Database Configuration
DATABASE_URL=postgresql://ms5user:ms5pass@localhost:${POSTGRES_PORT}/ms5db
REDIS_URL=redis://localhost:${REDIS_PORT}

# Service Ports
POSTGRES_PORT=${POSTGRES_PORT}
REDIS_PORT=${REDIS_PORT}
APP_PORT=${APP_PORT}

# API Configuration
API_ENDPOINT=http://localhost:${APP_PORT}
NODE_ENV=production
EOF

echo "Starting services with updated configuration..."
cd /opt/ms5
docker-compose -f docker-compose-fixed.yml up -d

echo ""
echo "Waiting for services to initialize..."
sleep 10

# Check service status
echo ""
echo "Service Status:"
docker-compose -f docker-compose-fixed.yml ps

# Create helper scripts with updated ports
cat > /usr/local/bin/ms5-connect << 'EOF'
#!/bin/bash
source /opt/ms5/.env
psql postgresql://ms5user:ms5pass@localhost:${POSTGRES_PORT}/ms5db
EOF
chmod +x /usr/local/bin/ms5-connect

cat > /usr/local/bin/ms5-redis << 'EOF'
#!/bin/bash
source /opt/ms5/.env
redis-cli -h localhost -p ${REDIS_PORT}
EOF
chmod +x /usr/local/bin/ms5-redis

cat > /usr/local/bin/ms5-status << 'EOF'
#!/bin/bash
echo "MS5.0 System Status:"
echo "===================="
docker-compose -f /opt/ms5/docker-compose-fixed.yml ps
echo ""
source /opt/ms5/.env
echo "Service Endpoints:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo "  API:        http://localhost:${APP_PORT}"
EOF
chmod +x /usr/local/bin/ms5-status

# Test connections
echo ""
echo "Testing connections..."
source /opt/ms5/.env

# Test PostgreSQL
if docker exec ms5-postgres psql -U ms5user -d ms5db -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL is running on port ${POSTGRES_PORT}"
else
    echo "❌ PostgreSQL connection failed"
fi

# Test Redis
if docker exec ms5-redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running on port ${REDIS_PORT}"
else
    echo "❌ Redis connection failed"
fi

# Test App
sleep 5
if curl -s http://localhost:${APP_PORT}/health > /dev/null 2>&1; then
    echo "✅ Application is running on port ${APP_PORT}"
else
    echo "⚠️  Application may still be starting..."
fi

echo ""
echo "================================================"
echo "   Installation Fixed!"
echo "================================================"
echo ""
echo "Service Endpoints:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo "  API:        http://localhost:${APP_PORT}"
echo ""
echo "Helper Commands:"
echo "  ms5-status   - Check system status"
echo "  ms5-connect  - Connect to PostgreSQL"
echo "  ms5-redis    - Connect to Redis CLI"
echo ""
echo "To view logs:"
echo "  docker logs ms5-postgres"
echo "  docker logs ms5-redis"
echo "  docker logs ms5-app"
echo ""