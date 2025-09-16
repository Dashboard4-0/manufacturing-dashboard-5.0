#!/bin/bash

# MS5.0 Debug Installation Script for Ubuntu
# This version shows detailed output to identify issues

set -x  # Enable debug output
set -e  # Exit on error

echo "================================================"
echo "   MS5.0 Installation - Debug Mode"
echo "================================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if running as root
echo "Checking root privileges..."
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi
print_status "Running as root"

echo ""
echo "Step 1: System Preparation"
echo "=========================="

# Check if we can update apt
echo "Testing apt-get..."
apt-get update 2>&1 | head -10

echo "Checking available packages..."
which curl || echo "curl not found"
which wget || echo "wget not found"
which docker || echo "docker not found"
which docker-compose || echo "docker-compose not found"

echo ""
echo "Installing required packages..."
apt-get install -y curl wget jq openssl netcat 2>&1 | tail -20

echo ""
echo "Checking Docker..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed"
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl start docker
    systemctl enable docker
fi

docker --version || print_error "Docker check failed"

echo ""
echo "Checking Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    print_warning "Docker Compose not found, installing..."
    # Try to install docker-compose
    apt-get install -y docker-compose || {
        echo "apt install failed, trying manual install..."
        curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    }
fi

docker-compose --version || print_error "Docker Compose check failed"

echo ""
echo "Step 2: Port Check"
echo "=================="

# Function to check port
check_port() {
    local port=$1
    echo "Checking port $port..."

    # Method 1: ss
    if command -v ss &> /dev/null; then
        ss -tuln | grep ":$port " && echo "Port $port is in use (ss)" || echo "Port $port is free (ss)"
    fi

    # Method 2: netstat
    if command -v netstat &> /dev/null; then
        netstat -tuln | grep ":$port " && echo "Port $port is in use (netstat)" || echo "Port $port is free (netstat)"
    fi

    # Method 3: lsof
    if command -v lsof &> /dev/null; then
        lsof -i :$port && echo "Port $port is in use (lsof)" || echo "Port $port is free (lsof)"
    fi

    # Method 4: nc
    nc -zv localhost $port 2>&1 | head -1
}

check_port 5432
check_port 6379
check_port 4000
check_port 3000

echo ""
echo "Step 3: Docker Test"
echo "==================="

echo "Docker info:"
docker info 2>&1 | head -10

echo ""
echo "Docker ps:"
docker ps

echo ""
echo "Testing Docker with hello-world..."
docker run --rm hello-world

echo ""
echo "================================================"
echo "   Debug Complete"
echo "================================================"
echo ""
echo "System Information:"
uname -a
echo ""
echo "OS Version:"
cat /etc/os-release | head -5
echo ""
echo "Memory:"
free -h
echo ""
echo "Disk Space:"
df -h /
echo ""

echo "If this script completed successfully, the issue is likely"
echo "with package installation or network connectivity."
echo ""
echo "Common issues:"
echo "1. Network proxy blocking apt-get"
echo "2. DNS resolution issues"
echo "3. Insufficient disk space"
echo "4. Docker daemon not running"