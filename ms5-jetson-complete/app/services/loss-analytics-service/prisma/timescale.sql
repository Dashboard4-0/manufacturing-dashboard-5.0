-- Create TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert telemetry table to hypertable
SELECT create_hypertable('telemetry', 'timestamp',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_telemetry_asset_time
  ON telemetry (assetId, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_line_time
  ON telemetry (lineId, timestamp DESC);

-- Convert losses table to hypertable
SELECT create_hypertable('losses', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Convert OEE calculations to hypertable
SELECT create_hypertable('oee_calculations', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Create continuous aggregate for hourly OEE
CREATE MATERIALIZED VIEW IF NOT EXISTS oee_hourly
WITH (timescaledb.continuous) AS
SELECT
  assetId,
  lineId,
  time_bucket('1 hour', timestamp) AS hour,
  AVG(oee) as avg_oee,
  AVG(availability) as avg_availability,
  AVG(performance) as avg_performance,
  AVG(quality) as avg_quality,
  MIN(oee) as min_oee,
  MAX(oee) as max_oee,
  COUNT(*) as sample_count
FROM oee_calculations
GROUP BY assetId, lineId, hour
WITH NO DATA;

-- Create continuous aggregate for daily OEE
CREATE MATERIALIZED VIEW IF NOT EXISTS oee_daily
WITH (timescaledb.continuous) AS
SELECT
  assetId,
  lineId,
  time_bucket('1 day', timestamp) AS day,
  AVG(oee) as avg_oee,
  AVG(availability) as avg_availability,
  AVG(performance) as avg_performance,
  AVG(quality) as avg_quality,
  MIN(oee) as min_oee,
  MAX(oee) as max_oee,
  STDDEV(oee) as stddev_oee,
  COUNT(*) as sample_count
FROM oee_calculations
GROUP BY assetId, lineId, day
WITH NO DATA;

-- Create continuous aggregate for loss analysis
CREATE MATERIALIZED VIEW IF NOT EXISTS loss_hourly
WITH (timescaledb.continuous) AS
SELECT
  lineId,
  category,
  subcategory,
  time_bucket('1 hour', timestamp) AS hour,
  SUM(duration) as total_duration,
  SUM(impact) as total_impact,
  COUNT(*) as occurrence_count,
  AVG(duration) as avg_duration
FROM losses
GROUP BY lineId, category, subcategory, hour
WITH NO DATA;

-- Create continuous aggregate for shift-based OEE
CREATE MATERIALIZED VIEW IF NOT EXISTS oee_shift
WITH (timescaledb.continuous) AS
SELECT
  lineId,
  time_bucket('8 hours', timestamp) AS shift_start,
  AVG(oee) as avg_oee,
  AVG(availability) as avg_availability,
  AVG(performance) as avg_performance,
  AVG(quality) as avg_quality,
  SUM(totalCount) as total_production,
  SUM(goodCount) as total_good,
  SUM(rejectCount) as total_rejects
FROM oee_calculations
GROUP BY lineId, shift_start
WITH NO DATA;

-- Add refresh policies for continuous aggregates
SELECT add_continuous_aggregate_policy('oee_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('oee_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');

SELECT add_continuous_aggregate_policy('loss_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('oee_shift',
  start_offset => INTERVAL '24 hours',
  end_offset => INTERVAL '8 hours',
  schedule_interval => INTERVAL '8 hours');

-- Add data retention policies
SELECT add_retention_policy('telemetry', INTERVAL '90 days');
SELECT add_retention_policy('losses', INTERVAL '180 days');
SELECT add_retention_policy('oee_calculations', INTERVAL '365 days');

-- Create function for Pareto analysis
CREATE OR REPLACE FUNCTION calculate_pareto_losses(
  p_line_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS TABLE (
  category VARCHAR,
  subcategory VARCHAR,
  reason VARCHAR,
  total_duration FLOAT,
  total_impact FLOAT,
  percentage FLOAT,
  cumulative_percentage FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH loss_summary AS (
    SELECT
      l.category,
      l.subcategory,
      l.reason,
      SUM(l.duration) as total_duration,
      SUM(l.impact) as total_impact
    FROM losses l
    WHERE l.lineId = p_line_id
      AND l.timestamp >= p_start_time
      AND l.timestamp < p_end_time
    GROUP BY l.category, l.subcategory, l.reason
  ),
  total_loss AS (
    SELECT SUM(total_duration) as grand_total
    FROM loss_summary
  ),
  ranked_losses AS (
    SELECT
      ls.*,
      (ls.total_duration / tl.grand_total * 100) as percentage,
      SUM(ls.total_duration) OVER (ORDER BY ls.total_duration DESC) / tl.grand_total * 100 as cumulative_percentage
    FROM loss_summary ls, total_loss tl
    ORDER BY ls.total_duration DESC
  )
  SELECT * FROM ranked_losses;
END;
$$ LANGUAGE plpgsql;

-- Create function for OEE trend analysis
CREATE OR REPLACE FUNCTION analyze_oee_trend(
  p_line_id UUID,
  p_days INT DEFAULT 30
)
RETURNS TABLE (
  trend_direction VARCHAR,
  trend_strength FLOAT,
  avg_oee FLOAT,
  improvement_rate FLOAT
) AS $$
DECLARE
  v_slope FLOAT;
  v_correlation FLOAT;
BEGIN
  WITH daily_oee AS (
    SELECT
      DATE(timestamp) as day,
      AVG(oee) as daily_oee,
      ROW_NUMBER() OVER (ORDER BY DATE(timestamp)) as day_number
    FROM oee_calculations
    WHERE lineId = p_line_id
      AND timestamp >= CURRENT_DATE - INTERVAL '1 day' * p_days
    GROUP BY DATE(timestamp)
  ),
  regression AS (
    SELECT
      regr_slope(daily_oee, day_number) as slope,
      regr_r2(daily_oee, day_number) as r_squared,
      AVG(daily_oee) as avg_oee
    FROM daily_oee
  )
  SELECT
    CASE
      WHEN slope > 0.5 THEN 'IMPROVING'
      WHEN slope < -0.5 THEN 'DECLINING'
      ELSE 'STABLE'
    END as trend_direction,
    r_squared as trend_strength,
    avg_oee,
    slope * 30 as improvement_rate -- projected 30-day change
  FROM regression;
END;
$$ LANGUAGE plpgsql;