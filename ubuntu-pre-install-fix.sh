#!/bin/bash

# MS5.0 Pre-Installation Port Cleanup for Ubuntu
# Run this BEFORE installing MS5 to prevent port conflicts

set -e

echo "================================================"
echo "   MS5.0 Pre-Installation Port Cleanup"
echo "================================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Function to check and handle port conflicts
check_and_free_port() {
    local PORT=$1
    local SERVICE_NAME=$2

    echo "Checking port $PORT ($SERVICE_NAME)..."

    # Check if port is in use
    if lsof -i :$PORT | grep -q LISTEN; then
        echo "  ⚠️  Port $PORT is in use"

        # Find what's using it
        PROCESS=$(lsof -i :$PORT | grep LISTEN | head -1)
        echo "  Process: $PROCESS"

        # Try to stop it gracefully
        case $PORT in
            5432)
                # PostgreSQL
                echo "  Stopping PostgreSQL services..."
                systemctl stop postgresql 2>/dev/null || true
                systemctl disable postgresql 2>/dev/null || true
                docker stop $(docker ps -q --filter "publish=5432") 2>/dev/null || true
                ;;
            6379)
                # Redis
                echo "  Stopping Redis services..."
                systemctl stop redis-server 2>/dev/null || true
                systemctl stop redis 2>/dev/null || true
                systemctl disable redis-server 2>/dev/null || true
                systemctl disable redis 2>/dev/null || true
                docker stop $(docker ps -q --filter "publish=6379") 2>/dev/null || true
                ;;
            *)
                # Other ports
                PID=$(lsof -t -i:$PORT | head -1)
                if [ -n "$PID" ]; then
                    echo "  Stopping process $PID..."
                    kill -TERM $PID 2>/dev/null || true
                    sleep 2
                    kill -9 $PID 2>/dev/null || true
                fi
                ;;
        esac

        sleep 2

        # Check again
        if lsof -i :$PORT | grep -q LISTEN; then
            echo "  ❌ Failed to free port $PORT"
            return 1
        else
            echo "  ✅ Port $PORT is now free"
        fi
    else
        echo "  ✅ Port $PORT is available"
    fi

    return 0
}

# Step 1: Stop all potentially conflicting services
echo "Step 1: Stopping potentially conflicting services..."
echo "===================================================="

# Stop system services
services=("postgresql" "redis-server" "redis" "docker")
for service in "${services[@]}"; do
    if systemctl is-active --quiet $service; then
        echo "Stopping $service..."
        systemctl stop $service 2>/dev/null || true
    fi
done

# Stop all Docker containers
echo "Stopping all Docker containers..."
docker stop $(docker ps -aq) 2>/dev/null || true

# Start Docker back up
echo "Starting Docker service..."
systemctl start docker
sleep 5

echo ""
echo "Step 2: Cleaning up old MS5 installations..."
echo "============================================"

# Remove old MS5 containers
docker rm ms5-postgres ms5-redis ms5-app ms5-auth 2>/dev/null || true
docker network rm ms5-network ms5_ms5-network 2>/dev/null || true

# Clean up old data
if [ -d "/opt/ms5" ]; then
    echo "Found old MS5 installation, backing up..."
    mv /opt/ms5 /opt/ms5.backup.$(date +%Y%m%d_%H%M%S)
fi

echo ""
echo "Step 3: Checking required ports..."
echo "==================================="

PORTS_OK=true

# Check each required port
check_and_free_port 5432 "PostgreSQL" || PORTS_OK=false
check_and_free_port 6379 "Redis" || PORTS_OK=false
check_and_free_port 4000 "MS5 App" || PORTS_OK=false
check_and_free_port 3000 "MS5 Auth" || PORTS_OK=false

echo ""
echo "Step 4: Creating clean environment..."
echo "====================================="

# Create MS5 directory
mkdir -p /opt/ms5/{data,config,logs}
cd /opt/ms5

# Create a test docker-compose to verify ports
cat > /opt/ms5/test-ports.yml << 'EOF'
version: '3.3'

services:
  test-postgres:
    image: busybox
    container_name: test-postgres
    command: nc -l -p 5432
    ports:
      - "5432:5432"

  test-redis:
    image: busybox
    container_name: test-redis
    command: nc -l -p 6379
    ports:
      - "6379:6379"
EOF

echo "Testing port availability with Docker..."
docker-compose -f test-ports.yml up -d 2>/dev/null

sleep 3

# Check if test containers started successfully
POSTGRES_TEST=$(docker ps | grep test-postgres | grep Up)
REDIS_TEST=$(docker ps | grep test-redis | grep Up)

docker-compose -f test-ports.yml down 2>/dev/null
rm test-ports.yml

echo ""
echo "================================================"
echo "   Pre-Installation Cleanup Complete"
echo "================================================"
echo ""

if [ -n "$POSTGRES_TEST" ] && [ -n "$REDIS_TEST" ]; then
    echo "✅ All ports are available and ready!"
    echo ""
    echo "You can now install MS5.0 without port conflicts."
    echo ""
    echo "Next step:"
    echo "  sudo bash ubuntu-ms5-complete-auth.sh"
else
    echo "⚠️  Some ports may still have issues:"
    [ -z "$POSTGRES_TEST" ] && echo "  - PostgreSQL port 5432"
    [ -z "$REDIS_TEST" ] && echo "  - Redis port 6379"
    echo ""
    echo "The installation script will use alternative ports if needed."
fi

echo ""
echo "Services that were stopped:"
for service in "${services[@]}"; do
    if ! systemctl is-active --quiet $service; then
        echo "  - $service (stopped)"
    fi
done

echo ""
echo "To restart these services later (if needed):"
echo "  sudo systemctl start postgresql"
echo "  sudo systemctl start redis-server"