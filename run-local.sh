#!/bin/bash

echo "🚀 MS5.0 Manufacturing System - Quick Start (Development Mode)"
echo "=============================================================="

# Check database status
echo "📊 Checking database status..."
if docker ps | grep -q ms5-postgres; then
  echo "✅ PostgreSQL is running"
else
  echo "❌ PostgreSQL is not running. Starting it..."
  docker-compose -f docker-compose.local.yml up -d
  echo "Waiting for database to be ready..."
  sleep 10
fi

if docker ps | grep -q ms5-redis; then
  echo "✅ Redis is running"
else
  echo "❌ Redis is not running. Starting it..."
  docker-compose -f docker-compose.local.yml up -d redis
  sleep 3
fi

# Test database connection
echo ""
echo "🔍 Testing database connection..."
docker exec ms5-postgres psql -U ms5user -d ms5db -c "SELECT COUNT(*) FROM production_lines;" 2>/dev/null && echo "✅ Database is accessible" || echo "⚠️  Database may still be initializing"

echo ""
echo "📝 System Status:"
echo "=================="
echo ""
echo "✅ Infrastructure Services:"
echo "   • PostgreSQL:  Running on port 5432"
echo "   • Redis:       Running on port 6379"
echo ""
echo "📦 Application Services:"
echo "   The application services require TypeScript compilation fixes."
echo "   For now, you can:"
echo ""
echo "   1. Access the database directly:"
echo "      psql postgresql://ms5user:ms5pass@localhost:5432/ms5db"
echo ""
echo "   2. Use Redis CLI:"
echo "      redis-cli -h localhost -p 6379"
echo ""
echo "   3. View container logs:"
echo "      docker logs ms5-postgres"
echo "      docker logs ms5-redis"
echo ""
echo "   4. Stop services:"
echo "      docker-compose -f docker-compose.local.yml down"
echo ""
echo "💡 Note: The full application stack has TypeScript compilation issues"
echo "   that need to be resolved before running the complete system."
echo ""
echo "📊 Database Schema:"
echo "   • production_lines - Manufacturing lines"
echo "   • assets - Equipment and machinery"
echo "   • users - System users"
echo "   • andon_calls - Andon system events"
echo "   • tier_boards - SQDC tier boards"
echo "   • sqdc_actions - Action items"
echo "   • telemetry - Sensor data"
echo "   • oee_metrics - OEE performance metrics"
echo "   • loss_events - Production loss tracking"
echo ""