#!/bin/bash
set -euo pipefail

echo "🗄️ Running Database Migrations"
echo "=============================="

# Environment variables
export DATABASE_URL="${DATABASE_URL:-postgresql://ms5:ms5_dev_password@localhost:5432/ms5}"
export TIMESCALE_URL="${TIMESCALE_URL:-postgresql://ms5_ts:ms5_ts_dev_password@localhost:5433/ms5_timeseries}"

# Function to run migrations for a service
run_migration() {
  local service_path=$1
  local service_name=$(basename "$service_path")

  if [ -d "$service_path/prisma" ]; then
    echo ""
    echo "📦 Migrating $service_name..."

    # Run Prisma migrations
    if [ -f "$service_path/prisma/schema.prisma" ]; then
      (cd "$service_path" && npx prisma migrate deploy) || {
        echo "⚠️ Failed to migrate $service_name"
        return 1
      }
      echo "✅ $service_name migrations complete"
    fi

    # Run TimescaleDB-specific SQL if exists
    if [ -f "$service_path/prisma/timescale.sql" ]; then
      echo "⏰ Running TimescaleDB setup for $service_name..."
      PGPASSWORD=ms5_ts_dev_password psql -h localhost -p 5433 -U ms5_ts -d ms5_timeseries < "$service_path/prisma/timescale.sql" || {
        echo "⚠️ Failed to setup TimescaleDB for $service_name"
        return 1
      }
      echo "✅ $service_name TimescaleDB setup complete"
    fi
  fi
}

# Run migrations for all services
echo "🔄 Running migrations for all services..."

# Services that use PostgreSQL
for service in services/*/; do
  run_migration "$service"
done

# Create shared database views
echo ""
echo "👁️ Creating shared database views..."

PGPASSWORD=ms5_dev_password psql -h localhost -p 5432 -U ms5 -d ms5 <<EOF
-- Tier board summary view
CREATE OR REPLACE VIEW tier_board_summary AS
SELECT
  l.id as line_id,
  l.name as line_name,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open' AND a.type = 'safety') as safety_actions,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open' AND a.type = 'quality') as quality_actions,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open' AND a.type = 'delivery') as delivery_actions,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open' AND a.type = 'cost') as cost_actions,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'open' AND a.type = 'people') as people_actions
FROM lines l
LEFT JOIN actions a ON a.line_id = l.id
GROUP BY l.id, l.name;

-- Asset health summary view
CREATE OR REPLACE VIEW asset_health_summary AS
SELECT
  a.id,
  a.name,
  a.type,
  a.line_id,
  COALESCE(AVG(t.oee) FILTER (WHERE t.timestamp > NOW() - INTERVAL '24 hours'), 0) as oee_24h,
  COALESCE(AVG(t.availability) FILTER (WHERE t.timestamp > NOW() - INTERVAL '24 hours'), 0) as availability_24h,
  COALESCE(AVG(t.performance) FILTER (WHERE t.timestamp > NOW() - INTERVAL '24 hours'), 0) as performance_24h,
  COALESCE(AVG(t.quality) FILTER (WHERE t.timestamp > NOW() - INTERVAL '24 hours'), 0) as quality_24h,
  COUNT(DISTINCT e.id) FILTER (WHERE e.severity = 'critical' AND e.timestamp > NOW() - INTERVAL '24 hours') as critical_events_24h
FROM assets a
LEFT JOIN telemetry t ON t.asset_id = a.id
LEFT JOIN events e ON e.asset_id = a.id
GROUP BY a.id;

-- Skill matrix summary view
CREATE OR REPLACE VIEW skill_matrix_summary AS
SELECT
  o.id as operator_id,
  o.name as operator_name,
  o.shift,
  COUNT(DISTINCT s.id) as total_skills,
  COUNT(DISTINCT s.id) FILTER (WHERE os.proficiency >= 80) as expert_skills,
  COUNT(DISTINCT s.id) FILTER (WHERE os.proficiency >= 60 AND os.proficiency < 80) as proficient_skills,
  COUNT(DISTINCT s.id) FILTER (WHERE os.proficiency < 60) as learning_skills
FROM operators o
LEFT JOIN operator_skills os ON os.operator_id = o.id
LEFT JOIN skills s ON s.id = os.skill_id
GROUP BY o.id;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO ms5;
GRANT SELECT ON ALL VIEWS IN SCHEMA public TO ms5;
EOF

echo "✅ Shared views created"

# Create TimescaleDB continuous aggregates
echo ""
echo "📊 Creating TimescaleDB continuous aggregates..."

PGPASSWORD=ms5_ts_dev_password psql -h localhost -p 5433 -U ms5_ts -d ms5_timeseries <<EOF
-- Hourly OEE aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS oee_hourly
WITH (timescaledb.continuous) AS
SELECT
  asset_id,
  time_bucket('1 hour', timestamp) AS hour,
  AVG(oee) as avg_oee,
  AVG(availability) as avg_availability,
  AVG(performance) as avg_performance,
  AVG(quality) as avg_quality,
  COUNT(*) as sample_count
FROM telemetry
GROUP BY asset_id, hour
WITH NO DATA;

-- Daily OEE aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS oee_daily
WITH (timescaledb.continuous) AS
SELECT
  asset_id,
  time_bucket('1 day', timestamp) AS day,
  AVG(oee) as avg_oee,
  AVG(availability) as avg_availability,
  AVG(performance) as avg_performance,
  AVG(quality) as avg_quality,
  MIN(oee) as min_oee,
  MAX(oee) as max_oee,
  COUNT(*) as sample_count
FROM telemetry
GROUP BY asset_id, day
WITH NO DATA;

-- Hourly event count aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS event_count_hourly
WITH (timescaledb.continuous) AS
SELECT
  asset_id,
  time_bucket('1 hour', timestamp) AS hour,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE severity = 'critical') as critical_events,
  COUNT(*) FILTER (WHERE severity = 'warning') as warning_events,
  COUNT(*) FILTER (WHERE severity = 'info') as info_events
FROM events
GROUP BY asset_id, hour
WITH NO DATA;

-- Refresh policies
SELECT add_continuous_aggregate_policy('oee_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('oee_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

SELECT add_continuous_aggregate_policy('event_count_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- Data retention policy (keep raw data for 90 days)
SELECT add_retention_policy('telemetry', INTERVAL '90 days');
SELECT add_retention_policy('events', INTERVAL '90 days');

GRANT SELECT ON ALL TABLES IN SCHEMA public TO ms5_ts;
GRANT SELECT ON ALL VIEWS IN SCHEMA public TO ms5_ts;
EOF

echo "✅ Continuous aggregates created"

echo ""
echo "✅ All database migrations complete!"