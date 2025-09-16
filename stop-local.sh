#!/bin/bash

# MS5.0 Manufacturing System - Stop Script

echo "🛑 Stopping MS5.0 Manufacturing System..."
echo "=========================================="

# Stop all services
echo "Stopping services..."
for pid_file in /tmp/ms5-*.pid; do
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file")
    service_name=$(basename "$pid_file" .pid | sed 's/ms5-//')
    echo "  - Stopping $service_name (PID: $pid)"
    kill "$pid" 2>/dev/null || true
    rm "$pid_file"
  fi
done

# Stop Docker containers
echo "Stopping Docker containers..."
docker-compose -f docker-compose.local.yml down

echo ""
echo "✅ All services stopped!"