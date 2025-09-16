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
