#!/bin/bash

# MS5.0 Manufacturing System - Local Development Startup Script

echo "🚀 Starting MS5.0 Manufacturing System - Local Development"
echo "=============================================="

# Check if Docker containers are running
echo "📦 Checking Docker containers..."
if ! docker ps | grep -q ms5-postgres; then
  echo "Starting PostgreSQL and Redis..."
  docker-compose -f docker-compose.local.yml up -d
  sleep 5
fi

# Export environment variables
export NODE_ENV=development
source .env

# Function to start a service
start_service() {
  local name=$1
  local dir=$2
  local cmd=$3

  echo "Starting $name..."
  cd "$dir" || exit
  $cmd > /tmp/ms5-$name.log 2>&1 &
  echo $! > /tmp/ms5-$name.pid
  cd - > /dev/null || exit
}

# Kill any existing services
echo "🔄 Cleaning up existing processes..."
for pid_file in /tmp/ms5-*.pid; do
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file")
    kill "$pid" 2>/dev/null || true
    rm "$pid_file"
  fi
done

# Build TypeScript libraries
echo "🔨 Building shared libraries..."
pnpm --filter @ms5/shared build

# Start services
echo "🎯 Starting services..."

# Gateway Service
start_service "gateway" "services/ms5.0-gateway" "pnpm dev"

# DMS Service
start_service "dms" "services/dms-service" "pnpm dev"

# Loss Analytics Service
start_service "loss" "services/loss-analytics-service" "pnpm dev"

# Edge Gateway Service
start_service "edge" "services/edge-gateway" "pnpm dev"

# Web Application (React)
start_service "web" "apps/web" "pnpm dev"

sleep 3

echo ""
echo "✅ All services started successfully!"
echo ""
echo "📍 Service URLs:"
echo "   - Web Application:    http://localhost:3000"
echo "   - GraphQL Gateway:    http://localhost:4000/graphql"
echo "   - DMS Service:        http://localhost:3001"
echo "   - Loss Service:       http://localhost:3002"
echo "   - Edge Service:       http://localhost:3003"
echo "   - PostgreSQL:         localhost:5432"
echo "   - Redis:              localhost:6379"
echo ""
echo "📊 Monitoring:"
echo "   - Logs: tail -f /tmp/ms5-*.log"
echo "   - Stop: ./stop-local.sh"
echo ""
echo "🎉 System ready for development!"