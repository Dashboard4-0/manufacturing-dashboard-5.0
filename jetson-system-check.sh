#!/bin/bash

# MS5.0 Jetson Orin System Information Collector
# Run this script on your target Recomputer J40 and share the output

echo "================================================"
echo "    MS5.0 Jetson System Information Check"
echo "================================================"
echo ""

# Basic system info
echo "=== SYSTEM INFO ==="
echo "Hostname: $(hostname)"
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
echo "CPU Info: $(lscpu | grep 'Model name' | cut -d':' -f2 | xargs)"
echo "Memory: $(free -h | grep Mem | awk '{print $2}')"
echo "Disk Space: $(df -h / | tail -1 | awk '{print $4}' ) available"
echo ""

# Check for Docker
echo "=== DOCKER STATUS ==="
if command -v docker &> /dev/null; then
    echo "Docker Version: $(docker --version)"
    echo "Docker Compose: $(docker-compose --version 2>/dev/null || echo 'Not installed')"
    echo "Docker Info:"
    sudo docker info 2>/dev/null | grep -E "Server Version|Storage Driver|Cgroup Driver"
else
    echo "Docker: Not installed"
fi
echo ""

# Check for Node.js
echo "=== NODE.JS STATUS ==="
if command -v node &> /dev/null; then
    echo "Node Version: $(node --version)"
    echo "NPM Version: $(npm --version 2>/dev/null || echo 'Not installed')"
else
    echo "Node.js: Not installed"
fi
echo ""

# Check for Python
echo "=== PYTHON STATUS ==="
echo "Python3 Version: $(python3 --version)"
echo "Pip3 Version: $(pip3 --version 2>/dev/null | cut -d' ' -f2 || echo 'Not installed')"
echo ""

# Check for databases
echo "=== DATABASE STATUS ==="
if command -v psql &> /dev/null; then
    echo "PostgreSQL Client: $(psql --version)"
else
    echo "PostgreSQL: Not installed"
fi

if command -v redis-cli &> /dev/null; then
    echo "Redis Client: $(redis-cli --version)"
else
    echo "Redis: Not installed"
fi
echo ""

# Check for systemd
echo "=== SYSTEMD STATUS ==="
echo "Systemd Version: $(systemctl --version | head -1)"
echo ""

# Check ports
echo "=== PORT AVAILABILITY ==="
for port in 3000 4000 5432 6379 9090 3100; do
    if sudo lsof -i:$port &>/dev/null; then
        echo "Port $port: IN USE"
    else
        echo "Port $port: Available"
    fi
done
echo ""

# Check NVIDIA/CUDA
echo "=== NVIDIA/CUDA STATUS ==="
if command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA Driver: $(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || echo 'Unable to query')"
    echo "CUDA Version: $(nvcc --version 2>/dev/null | grep release | cut -d',' -f2 | cut -d' ' -f3 || echo 'Not found')"
else
    echo "NVIDIA Tools: Not found (may be using Tegra)"
fi

# Check Jetson specific
if [ -f /etc/nv_tegra_release ]; then
    echo "Jetson L4T Version:"
    cat /etc/nv_tegra_release
fi

if command -v jetson_clocks &> /dev/null; then
    echo "Jetson Clocks: Available"
fi

if command -v tegrastats &> /dev/null; then
    echo "Tegrastats: Available"
fi
echo ""

# Check network interfaces
echo "=== NETWORK INTERFACES ==="
ip -br addr show | grep -E "^(eth|wlan|docker)"
echo ""

# Check package managers
echo "=== PACKAGE MANAGERS ==="
echo "APT packages count: $(dpkg -l | wc -l)"
echo "Snap: $(snap --version 2>/dev/null | head -1 || echo 'Not installed')"
echo ""

# Check storage
echo "=== STORAGE DETAILS ==="
df -h | grep -E "^/dev|Filesystem"
echo ""
echo "Mount points:"
mount | grep -E "^/dev" | cut -d' ' -f1-3
echo ""

# Check essential libraries
echo "=== ESSENTIAL LIBRARIES ==="
ldconfig -p 2>/dev/null | grep -E "(libssl|libcrypto|libpq|libcurl)" | head -5 || echo "Unable to check libraries"
echo ""

# Create summary file
echo "=== GENERATING SUMMARY ==="
OUTPUT_FILE="/tmp/jetson_system_info_$(date +%Y%m%d_%H%M%S).txt"
echo "Saving detailed output to: $OUTPUT_FILE"

# Save everything to file
{
    echo "Jetson System Information Report"
    echo "Generated: $(date)"
    echo "================================"
    echo ""
    echo "System: $(uname -a)"
    echo "Memory: $(free -h)"
    echo "CPU: $(lscpu)"
    echo "Disk: $(df -h)"
    echo ""
    echo "Installed Packages (key ones):"
    dpkg -l | grep -E "(docker|python|node|postgres|redis|nginx)" || true
} > "$OUTPUT_FILE"

echo ""
echo "================================================"
echo "    Check Complete!"
echo "================================================"
echo ""
echo "Please share:"
echo "1. The output shown above"
echo "2. The file: $OUTPUT_FILE"
echo ""
echo "Run this command to display the summary:"
echo "cat $OUTPUT_FILE"