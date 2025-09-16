#!/bin/bash
set -euo pipefail

echo "🌱 Seeding Database"
echo "==================="

# Environment variables
export DATABASE_URL="${DATABASE_URL:-postgresql://ms5:ms5_dev_password@localhost:5432/ms5}"
export TIMESCALE_URL="${TIMESCALE_URL:-postgresql://ms5_ts:ms5_ts_dev_password@localhost:5433/ms5_timeseries}"

# Function to run seed script for a service
run_seed() {
  local service_path=$1
  local service_name=$(basename "$service_path")

  if [ -f "$service_path/prisma/seed.ts" ]; then
    echo ""
    echo "🌱 Seeding $service_name..."
    (cd "$service_path" && npx tsx prisma/seed.ts) || {
      echo "⚠️ Failed to seed $service_name"
      return 1
    }
    echo "✅ $service_name seeded"
  fi
}

# Seed master data first (sites, lines, assets, products)
echo "📍 Seeding master data..."
run_seed "services/master-data-service"

# Seed other services in dependency order
echo ""
echo "🔄 Seeding dependent services..."

# Core services
run_seed "services/operator-care-service"
run_seed "services/skills-service"
run_seed "services/early-asset-mgmt-service"
run_seed "services/centerline-service"
run_seed "services/standard-work-service"

# Operational services
run_seed "services/dms-service"
run_seed "services/loss-analytics-service"
run_seed "services/quality-spc-service"
run_seed "services/pm-planner-service"
run_seed "services/andon-service"
run_seed "services/problem-solving-service"
run_seed "services/handover-service"
run_seed "services/safety-service"
run_seed "services/energy-service"
run_seed "services/compliance-audit-service"
run_seed "services/governance-maturity-service"

# Integration hub
run_seed "services/integration-hub"

# Generate sample time-series data
echo ""
echo "📈 Generating sample time-series data..."

PGPASSWORD=ms5_ts_dev_password psql -h localhost -p 5433 -U ms5_ts -d ms5_timeseries <<EOF
-- Generate telemetry data for the last 7 days
INSERT INTO telemetry (asset_id, timestamp, oee, availability, performance, quality, runtime, downtime, good_count, reject_count)
SELECT
  a.asset_id,
  generate_series(
    NOW() - INTERVAL '7 days',
    NOW(),
    INTERVAL '5 minutes'
  ) as timestamp,
  60 + random() * 35 as oee,
  70 + random() * 25 as availability,
  65 + random() * 30 as performance,
  85 + random() * 13 as quality,
  280 + random() * 20 as runtime,
  20 + random() * 10 as downtime,
  (900 + random() * 100)::int as good_count,
  (10 + random() * 20)::int as reject_count
FROM (
  SELECT generate_series(
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440010'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  ) as asset_id
) a;

-- Generate event data for the last 7 days
INSERT INTO events (asset_id, timestamp, type, severity, description, metadata)
SELECT
  a.asset_id,
  generate_series(
    NOW() - INTERVAL '7 days',
    NOW(),
    INTERVAL '2 hours'
  ) as timestamp,
  (ARRAY['breakdown', 'changeover', 'adjustment', 'minor_stop'])[floor(random() * 4 + 1)] as type,
  (ARRAY['info', 'warning', 'critical'])[floor(random() * 3 + 1)] as severity,
  'Sample event for testing' as description,
  '{"duration": ' || (5 + random() * 55)::int || ', "resolved": true}'::jsonb as metadata
FROM (
  SELECT generate_series(
    '550e8400-e29b-41d4-a716-446655440001'::uuid,
    '550e8400-e29b-41d4-a716-446655440010'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  ) as asset_id
) a;

-- Generate SPC sample data
INSERT INTO spc_samples (product_id, characteristic, timestamp, value, ucl, lcl, target)
SELECT
  p.product_id,
  c.characteristic,
  generate_series(
    NOW() - INTERVAL '7 days',
    NOW(),
    INTERVAL '30 minutes'
  ) as timestamp,
  50 + random() * 10 as value,
  60 as ucl,
  40 as lcl,
  50 as target
FROM (
  SELECT generate_series(
    '650e8400-e29b-41d4-a716-446655440001'::uuid,
    '650e8400-e29b-41d4-a716-446655440005'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  ) as product_id
) p
CROSS JOIN (
  SELECT unnest(ARRAY['dimension_a', 'dimension_b', 'weight', 'thickness']) as characteristic
) c;

-- Refresh continuous aggregates with the new data
REFRESH MATERIALIZED VIEW CONCURRENTLY oee_hourly;
REFRESH MATERIALIZED VIEW CONCURRENTLY oee_daily;
REFRESH MATERIALIZED VIEW CONCURRENTLY event_count_hourly;
EOF

echo "✅ Sample time-series data generated"

# Generate sample audit records
echo ""
echo "📝 Generating sample audit records..."

PGPASSWORD=ms5_dev_password psql -h localhost -p 5432 -U ms5 -d ms5 <<EOF
-- Sample audit records
INSERT INTO audit_records (id, timestamp, user_id, action, resource, result, metadata, hash, previous_hash)
VALUES
  ('750e8400-e29b-41d4-a716-446655440001', NOW() - INTERVAL '6 days', 'user-001', 'CREATE', 'action', 'SUCCESS', '{"action_id": "123"}', SHA256('initial'), NULL),
  ('750e8400-e29b-41d4-a716-446655440002', NOW() - INTERVAL '5 days', 'user-002', 'UPDATE', 'centerline', 'SUCCESS', '{"centerline_id": "456"}', SHA256('second'), SHA256('initial')),
  ('750e8400-e29b-41d4-a716-446655440003', NOW() - INTERVAL '4 days', 'user-001', 'DELETE', 'deviation', 'DENIED', '{"reason": "insufficient_permissions"}', SHA256('third'), SHA256('second')),
  ('750e8400-e29b-41d4-a716-446655440004', NOW() - INTERVAL '3 days', 'user-003', 'APPROVE', 'permit', 'SUCCESS', '{"permit_id": "789"}', SHA256('fourth'), SHA256('third')),
  ('750e8400-e29b-41d4-a716-446655440005', NOW() - INTERVAL '2 days', 'user-002', 'CREATE', 'andon', 'SUCCESS', '{"andon_id": "abc"}', SHA256('fifth'), SHA256('fourth'));
EOF

echo "✅ Sample audit records generated"

echo ""
echo "✅ Database seeding complete!"
echo ""
echo "📊 Sample data created:"
echo "  - Sites, areas, lines, and assets"
echo "  - Operators and skills"
echo "  - Products and orders"
echo "  - 7 days of telemetry data (5-minute intervals)"
echo "  - 7 days of event data"
echo "  - 7 days of SPC samples"
echo "  - Sample audit records"