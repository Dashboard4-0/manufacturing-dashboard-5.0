-- MS5.0 Manufacturing System Database Initialization

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create base tables
CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    line_id UUID REFERENCES production_lines(id),
    type VARCHAR(100),
    serial_number VARCHAR(255),
    status VARCHAR(50) DEFAULT 'operational',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'operator',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS andon_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    line_id UUID REFERENCES production_lines(id),
    station_id VARCHAR(100),
    type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'TRIGGERED',
    triggered_by UUID REFERENCES users(id),
    acknowledged_by UUID REFERENCES users(id),
    resolved_by UUID REFERENCES users(id),
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS tier_boards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    line_id UUID REFERENCES production_lines(id),
    date DATE NOT NULL,
    shift VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sqdc_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tier_board_id UUID REFERENCES tier_boards(id),
    category VARCHAR(50) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(50) DEFAULT 'medium',
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create hypertables for time-series data
CREATE TABLE IF NOT EXISTS telemetry (
    timestamp TIMESTAMP NOT NULL,
    asset_id UUID NOT NULL,
    temperature FLOAT,
    pressure FLOAT,
    vibration FLOAT,
    speed FLOAT,
    metadata JSONB
);
SELECT create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS oee_metrics (
    timestamp TIMESTAMP NOT NULL,
    asset_id UUID NOT NULL,
    line_id UUID,
    availability FLOAT,
    performance FLOAT,
    quality FLOAT,
    oee FLOAT,
    runtime INTEGER,
    planned_time INTEGER,
    total_count INTEGER,
    good_count INTEGER,
    defect_count INTEGER
);
SELECT create_hypertable('oee_metrics', 'timestamp', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS loss_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    loss_category VARCHAR(100),
    loss_reason VARCHAR(255),
    duration_minutes INTEGER,
    impact_units INTEGER,
    notes TEXT
);

-- Create indexes for performance
CREATE INDEX idx_telemetry_asset_time ON telemetry (asset_id, timestamp DESC);
CREATE INDEX idx_oee_metrics_asset_time ON oee_metrics (asset_id, timestamp DESC);
CREATE INDEX idx_loss_events_asset ON loss_events (asset_id, start_time DESC);
CREATE INDEX idx_andon_calls_line ON andon_calls (line_id, triggered_at DESC);
CREATE INDEX idx_sqdc_actions_board ON sqdc_actions (tier_board_id, status);

-- Insert sample data for testing
INSERT INTO production_lines (name, area_id, status) VALUES
    ('Assembly Line 1', 'AREA-A', 'active'),
    ('Packaging Line 1', 'AREA-B', 'active'),
    ('Quality Control Line', 'AREA-C', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO users (email, name, role) VALUES
    ('admin@ms5.local', 'System Admin', 'admin'),
    ('operator1@ms5.local', 'John Operator', 'operator'),
    ('supervisor@ms5.local', 'Jane Supervisor', 'supervisor')
ON CONFLICT DO NOTHING;

-- Create sample assets
INSERT INTO assets (name, line_id, type, serial_number, status)
SELECT
    'Machine ' || generate_series,
    (SELECT id FROM production_lines ORDER BY RANDOM() LIMIT 1),
    CASE WHEN RANDOM() < 0.5 THEN 'CNC' ELSE 'Assembly' END,
    'SN-' || generate_series,
    'operational'
FROM generate_series(1, 5)
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ms5user;