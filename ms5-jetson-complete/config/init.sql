-- MS5.0 Database Schema Initialization

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables
CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'IDLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    line_id UUID REFERENCES production_lines(id),
    type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'IDLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telemetry (
    id SERIAL PRIMARY KEY,
    asset_id UUID REFERENCES assets(id),
    temperature FLOAT,
    pressure FLOAT,
    vibration FLOAT,
    speed INTEGER,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oee_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id),
    availability FLOAT,
    performance FLOAT,
    quality FLOAT,
    oee FLOAT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'OPERATOR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_telemetry_timestamp ON telemetry(timestamp DESC);
CREATE INDEX idx_telemetry_asset ON telemetry(asset_id, timestamp DESC);
CREATE INDEX idx_oee_timestamp ON oee_metrics(timestamp DESC);
CREATE INDEX idx_oee_asset ON oee_metrics(asset_id, timestamp DESC);

-- Insert default data
INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@ms5.local', '$2b$10$K7L1OJ0TfgK7h3jPdK8jXuNHjLxqv4ZK2H3mKQ2H8nZxKqwKqwKqw', 'ADMIN')
ON CONFLICT (username) DO NOTHING;

INSERT INTO production_lines (name, area_id, status) VALUES
('Assembly Line 1', 'AREA_A', 'RUNNING'),
('Packaging Line 1', 'AREA_B', 'RUNNING'),
('Quality Control', 'AREA_C', 'IDLE')
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ms5user;
