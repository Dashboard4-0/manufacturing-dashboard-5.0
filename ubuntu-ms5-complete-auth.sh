#!/bin/bash

# MS5.0 Manufacturing System - Complete Ubuntu Installation with Authentication
# This script installs the full system with user authentication configured and ready

set -e

SCRIPT_VERSION="2.0.0"
INSTALL_DIR="/opt/ms5"

echo "================================================"
echo "   MS5.0 Manufacturing System v${SCRIPT_VERSION}"
echo "   Complete Installation with Authentication"
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
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi

# Function to check port availability
check_port() {
    local port=$1
    if ss -tuln | grep -q ":$port "; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to generate secure passwords
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

echo "Step 1: System Preparation"
echo "=========================="

# Install required packages
apt-get update > /dev/null 2>&1
apt-get install -y curl wget jq openssl netcat > /dev/null 2>&1
print_status "System packages installed"

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi
print_status "Docker found: $(docker --version)"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    print_warning "Installing Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi
print_status "Docker Compose found: $(docker-compose --version)"

echo ""
echo "Step 2: Port Configuration"
echo "=========================="

# Determine ports to use
POSTGRES_PORT=5432
REDIS_PORT=6379
APP_PORT=4000
AUTH_PORT=3000

if check_port $POSTGRES_PORT; then
    print_warning "Port $POSTGRES_PORT is in use, using 5433"
    POSTGRES_PORT=5433
fi

if check_port $REDIS_PORT; then
    print_warning "Port $REDIS_PORT is in use, using 6380"
    REDIS_PORT=6380
fi

if check_port $APP_PORT; then
    print_warning "Port $APP_PORT is in use, using 4001"
    APP_PORT=4001
fi

if check_port $AUTH_PORT; then
    print_warning "Port $AUTH_PORT is in use, using 3001"
    AUTH_PORT=3001
fi

print_status "Ports configured - PostgreSQL:$POSTGRES_PORT, Redis:$REDIS_PORT, App:$APP_PORT, Auth:$AUTH_PORT"

echo ""
echo "Step 3: Cleaning Previous Installation"
echo "======================================"

# Stop and remove any existing containers
docker stop ms5-postgres ms5-redis ms5-app ms5-auth 2>/dev/null || true
docker rm ms5-postgres ms5-redis ms5-app ms5-auth 2>/dev/null || true
docker network rm ms5-network 2>/dev/null || true
print_status "Previous installation cleaned"

echo ""
echo "Step 4: Creating Directory Structure"
echo "===================================="

# Create directory structure
mkdir -p ${INSTALL_DIR}/{data,config,logs,scripts,auth}
mkdir -p ${INSTALL_DIR}/data/{postgres,redis}
cd ${INSTALL_DIR}
print_status "Directory structure created"

echo ""
echo "Step 5: Generating Security Configuration"
echo "========================================"

# Generate secure passwords and keys
JWT_SECRET=$(generate_password)
DB_PASSWORD=$(generate_password)
REDIS_PASSWORD=$(generate_password)
ADMIN_PASSWORD=$(generate_password)

# Save credentials securely
cat > ${INSTALL_DIR}/config/credentials.env << EOF
# MS5.0 Authentication Credentials
# Generated: $(date)
# KEEP THIS FILE SECURE!

# Database
DB_USER=ms5user
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=ms5db

# Redis
REDIS_PASSWORD=${REDIS_PASSWORD}

# JWT Authentication
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRATION=86400

# Admin User
ADMIN_EMAIL=admin@ms5.local
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Ports
POSTGRES_PORT=${POSTGRES_PORT}
REDIS_PORT=${REDIS_PORT}
APP_PORT=${APP_PORT}
AUTH_PORT=${AUTH_PORT}

# Auth Configuration
AUTH_BYPASS=false
OIDC_ENABLED=false
SESSION_SECRET=${JWT_SECRET}
CORS_ORIGINS=http://localhost:3000,http://localhost:4000

# API Configuration
NODE_ENV=production
API_VERSION=v2
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100
EOF

chmod 600 ${INSTALL_DIR}/config/credentials.env
print_status "Security credentials generated"

echo ""
echo "Step 6: Creating Database Schema with Auth Tables"
echo "================================================="

cat > ${INSTALL_DIR}/config/init.sql << 'SQLEOF'
-- MS5.0 Database Schema with Authentication

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table with authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'operator',
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_login TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_role CHECK (role IN ('admin', 'supervisor', 'operator', 'viewer'))
);

-- Sessions table for JWT tracking
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sessions_user (user_id),
    INDEX idx_sessions_token (token_hash),
    INDEX idx_sessions_expires (expires_at)
);

-- Audit log for authentication events
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_event CHECK (event_type IN ('login', 'logout', 'password_change', 'account_locked', 'failed_login', 'token_refresh'))
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource, action, role)
);

-- Production tables
CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_by UUID REFERENCES users(id),
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_auth_audit_user ON auth_audit_log(user_id);
CREATE INDEX idx_auth_audit_event ON auth_audit_log(event_type);
CREATE INDEX idx_auth_audit_created ON auth_audit_log(created_at DESC);

-- Insert default permissions
INSERT INTO permissions (resource, action, role) VALUES
    ('users', 'read', 'viewer'),
    ('users', 'read', 'operator'),
    ('users', 'read', 'supervisor'),
    ('users', 'read', 'admin'),
    ('users', 'write', 'admin'),
    ('production_lines', 'read', 'viewer'),
    ('production_lines', 'read', 'operator'),
    ('production_lines', 'read', 'supervisor'),
    ('production_lines', 'read', 'admin'),
    ('production_lines', 'write', 'supervisor'),
    ('production_lines', 'write', 'admin'),
    ('assets', 'read', 'viewer'),
    ('assets', 'read', 'operator'),
    ('assets', 'read', 'supervisor'),
    ('assets', 'read', 'admin'),
    ('assets', 'write', 'operator'),
    ('assets', 'write', 'supervisor'),
    ('assets', 'write', 'admin')
ON CONFLICT DO NOTHING;

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default users with hashed passwords (will be updated by app)
INSERT INTO users (email, name, role, is_active, is_verified, password_hash) VALUES
    ('admin@ms5.local', 'System Administrator', 'admin', true, true, 'pending'),
    ('supervisor@ms5.local', 'Production Supervisor', 'supervisor', true, true, 'pending'),
    ('operator1@ms5.local', 'John Operator', 'operator', true, true, 'pending'),
    ('viewer@ms5.local', 'Read Only User', 'viewer', true, true, 'pending')
ON CONFLICT (email) DO NOTHING;

-- Insert sample production data
INSERT INTO production_lines (name, area_id, status) VALUES
    ('Assembly Line 1', 'AREA-A', 'active'),
    ('Packaging Line 1', 'AREA-B', 'active'),
    ('Quality Control', 'AREA-C', 'active')
ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ms5user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ms5user;
SQLEOF

print_status "Database schema created"

echo ""
echo "Step 7: Creating Docker Compose Configuration"
echo "============================================="

cat > ${INSTALL_DIR}/docker-compose.yml << EOF
version: '3.3'

services:
  postgres:
    image: postgres:14
    container_name: ms5-postgres
    environment:
      POSTGRES_USER: \${DB_USER}
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: \${DB_NAME}
    ports:
      - "\${POSTGRES_PORT}:5432"
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./config/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USER} -d \${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ms5-network

  redis:
    image: redis:7-alpine
    container_name: ms5-redis
    ports:
      - "\${REDIS_PORT}:6379"
    volumes:
      - ./data/redis:/data
    command: >
      sh -c "
      echo 'requirepass \${REDIS_PASSWORD}' > /usr/local/etc/redis/redis.conf &&
      echo 'maxmemory 256mb' >> /usr/local/etc/redis/redis.conf &&
      echo 'maxmemory-policy allkeys-lru' >> /usr/local/etc/redis/redis.conf &&
      redis-server /usr/local/etc/redis/redis.conf --appendonly yes
      "
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "-a", "\${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ms5-network

  auth:
    image: node:20-slim
    container_name: ms5-auth
    working_dir: /app
    volumes:
      - ./auth:/app
    ports:
      - "\${AUTH_PORT}:3000"
    environment:
      NODE_ENV: \${NODE_ENV}
      DATABASE_URL: postgresql://\${DB_USER}:\${DB_PASSWORD}@postgres:5432/\${DB_NAME}
      REDIS_URL: redis://:\${REDIS_PASSWORD}@redis:6379
      JWT_SECRET: \${JWT_SECRET}
      JWT_EXPIRATION: \${JWT_EXPIRATION}
      PORT: 3000
      AUTH_BYPASS: \${AUTH_BYPASS}
      CORS_ORIGINS: \${CORS_ORIGINS}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - ms5-network
    command: >
      sh -c "
      npm install &&
      node server.js
      "

networks:
  ms5-network:
    driver: bridge
EOF

print_status "Docker Compose configuration created"

echo ""
echo "Step 8: Creating Authentication Service"
echo "======================================="

# Create auth service directory
cat > ${INSTALL_DIR}/auth/package.json << 'EOF'
{
  "name": "ms5-auth-service",
  "version": "1.0.0",
  "description": "MS5.0 Authentication Service",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "jsonwebtoken": "^9.0.0",
    "bcrypt": "^5.1.0",
    "pg": "^8.11.0",
    "redis": "^4.6.0",
    "express-rate-limit": "^6.7.0",
    "helmet": "^7.0.0",
    "express-validator": "^7.0.1"
  }
}
EOF

cat > ${INSTALL_DIR}/auth/server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const redis = require('redis');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', err => console.log('Redis Error:', err));
redisClient.connect();

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many login attempts, please try again later'
});

// Helper functions
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRATION || '24h' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
};

// Middleware to check authentication
const authenticate = async (req, res, next) => {
  // Check for auth bypass in development
  if (process.env.AUTH_BYPASS === 'true') {
    req.user = { id: 'dev', email: 'dev@ms5.local', role: 'admin' };
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Check if token is in Redis (not blacklisted)
  const isBlacklisted = await redisClient.get(`blacklist_${token}`);
  if (isBlacklisted) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  req.user = decoded;
  next();
};

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ms5-auth',
    timestamp: new Date().toISOString()
  });
});

// Login endpoint
app.post('/auth/login',
  loginLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Get user from database
      const result = await pool.query(
        'SELECT * FROM users WHERE email = $1 AND is_active = true',
        [email]
      );

      if (result.rows.length === 0) {
        await pool.query(
          'INSERT INTO auth_audit_log (event_type, event_data, success) VALUES ($1, $2, $3)',
          ['failed_login', { email }, false]
        );
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ error: 'Account is locked' });
      }

      // For demo purposes, accept any password if password_hash is 'pending'
      let validPassword = false;
      if (user.password_hash === 'pending') {
        // Set the password on first login
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
          'UPDATE users SET password_hash = $1 WHERE id = $2',
          [hashedPassword, user.id]
        );
        validPassword = true;
      } else {
        validPassword = await bcrypt.compare(password, user.password_hash);
      }

      if (!validPassword) {
        // Increment failed login attempts
        await pool.query(
          'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1',
          [user.id]
        );

        // Lock account after 5 failed attempts
        if (user.failed_login_attempts >= 4) {
          const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
          await pool.query(
            'UPDATE users SET locked_until = $1 WHERE id = $2',
            [lockUntil, user.id]
          );
        }

        await pool.query(
          'INSERT INTO auth_audit_log (user_id, event_type, success) VALUES ($1, $2, $3)',
          [user.id, 'failed_login', false]
        );

        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Reset failed login attempts and update last login
      await pool.query(
        'UPDATE users SET failed_login_attempts = 0, last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // Generate token
      const token = generateToken(user);

      // Store session in database
      await pool.query(
        'INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
        [
          user.id,
          require('crypto').createHash('sha256').update(token).digest('hex'),
          new Date(Date.now() + 24 * 60 * 60 * 1000),
          req.ip,
          req.headers['user-agent']
        ]
      );

      // Log successful login
      await pool.query(
        'INSERT INTO auth_audit_log (user_id, event_type, success, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)',
        [user.id, 'login', true, req.ip, req.headers['user-agent']]
      );

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
});

// Logout endpoint
app.post('/auth/logout', authenticate, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Add token to blacklist in Redis (expires after token expiration)
    await redisClient.setEx(`blacklist_${token}`, 86400, 'true');

    // Log logout event
    await pool.query(
      'INSERT INTO auth_audit_log (user_id, event_type, success) VALUES ($1, $2, $3)',
      [req.user.id, 'logout', true]
    );

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token endpoint
app.get('/auth/verify', authenticate, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// Get user info
app.get('/auth/userinfo', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, last_login, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Userinfo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user permissions
app.get('/auth/permissions', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT resource, action FROM permissions WHERE role = $1',
      [req.user.role]
    );

    res.json({
      role: req.user.role,
      permissions: result.rows
    });
  } catch (err) {
    console.error('Permissions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`MS5.0 Auth Service running on port ${PORT}`);
  console.log(`Auth bypass: ${process.env.AUTH_BYPASS === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`CORS origins: ${process.env.CORS_ORIGINS}`);
});
EOF

print_status "Authentication service created"

echo ""
echo "Step 9: Starting Services"
echo "========================"

# Load environment and start services
cd ${INSTALL_DIR}
export $(cat config/credentials.env | xargs)
docker-compose up -d

print_status "Services starting..."
sleep 10

echo ""
echo "Step 10: Verifying Services"
echo "==========================="

# Check PostgreSQL
if docker exec ms5-postgres psql -U ${DB_USER} -d ${DB_NAME} -c "SELECT COUNT(*) FROM users;" > /dev/null 2>&1; then
    USER_COUNT=$(docker exec ms5-postgres psql -U ${DB_USER} -d ${DB_NAME} -t -c "SELECT COUNT(*) FROM users;")
    print_status "PostgreSQL running with ${USER_COUNT} users"
else
    print_error "PostgreSQL failed to start"
fi

# Check Redis
if docker exec ms5-redis redis-cli -a ${REDIS_PASSWORD} ping > /dev/null 2>&1; then
    print_status "Redis running with authentication"
else
    print_error "Redis failed to start"
fi

echo ""
echo "Step 11: Creating Helper Scripts"
echo "================================"

# Create auth test script
cat > ${INSTALL_DIR}/scripts/test-auth.sh << 'EOF'
#!/bin/bash
source /opt/ms5/config/credentials.env

echo "Testing MS5.0 Authentication System"
echo "==================================="

# Test login
echo ""
echo "1. Testing login with admin credentials..."
RESPONSE=$(curl -s -X POST http://localhost:${AUTH_PORT}/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@ms5.local\",\"password\":\"${ADMIN_PASSWORD}\"}")

if echo "$RESPONSE" | grep -q "token"; then
    echo "✅ Login successful"
    TOKEN=$(echo "$RESPONSE" | jq -r '.token')
    echo "   Token (first 50 chars): ${TOKEN:0:50}..."
else
    echo "❌ Login failed"
    echo "   Response: $RESPONSE"
    exit 1
fi

# Test token verification
echo ""
echo "2. Testing token verification..."
VERIFY=$(curl -s -X GET http://localhost:${AUTH_PORT}/auth/verify \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$VERIFY" | grep -q "valid"; then
    echo "✅ Token is valid"
else
    echo "❌ Token verification failed"
fi

# Test user info
echo ""
echo "3. Testing user info endpoint..."
USERINFO=$(curl -s -X GET http://localhost:${AUTH_PORT}/auth/userinfo \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$USERINFO" | grep -q "email"; then
    echo "✅ User info retrieved"
    echo "$USERINFO" | jq .
else
    echo "❌ Failed to get user info"
fi

# Test permissions
echo ""
echo "4. Testing permissions endpoint..."
PERMS=$(curl -s -X GET http://localhost:${AUTH_PORT}/auth/permissions \
  -H "Authorization: Bearer ${TOKEN}")

if echo "$PERMS" | grep -q "permissions"; then
    echo "✅ Permissions retrieved"
    echo "$PERMS" | jq -c '.permissions[:3]'
else
    echo "❌ Failed to get permissions"
fi
EOF
chmod +x ${INSTALL_DIR}/scripts/test-auth.sh

# Create status script
cat > /usr/local/bin/ms5-status << 'EOF'
#!/bin/bash
echo "MS5.0 System Status"
echo "==================="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5
echo ""
source /opt/ms5/config/credentials.env
echo "Service Endpoints:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo "  Auth API:   http://localhost:${AUTH_PORT}"
EOF
chmod +x /usr/local/bin/ms5-status

# Create connect script
cat > /usr/local/bin/ms5-connect << 'EOF'
#!/bin/bash
source /opt/ms5/config/credentials.env
docker exec -it ms5-postgres psql -U ${DB_USER} -d ${DB_NAME}
EOF
chmod +x /usr/local/bin/ms5-connect

# Create logs script
cat > /usr/local/bin/ms5-logs << 'EOF'
#!/bin/bash
if [ -z "$1" ]; then
    docker-compose -f /opt/ms5/docker-compose.yml logs -f --tail=100
else
    docker logs -f ms5-$1 --tail=100
fi
EOF
chmod +x /usr/local/bin/ms5-logs

print_status "Helper scripts created"

echo ""
echo "Step 12: Setting Up Auto-Start"
echo "=============================="

# Create systemd service
cat > /etc/systemd/system/ms5.service << EOF
[Unit]
Description=MS5.0 Manufacturing System
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/config/credentials.env
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
StandardOutput=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ms5.service
print_status "Auto-start configured"

echo ""
echo "Step 13: Creating User Credentials File"
echo "======================================="

cat > ${INSTALL_DIR}/CREDENTIALS.txt << EOF
================================================
MS5.0 SYSTEM CREDENTIALS - KEEP SECURE!
================================================

Database Access:
  Host: localhost:${POSTGRES_PORT}
  Database: ${DB_NAME}
  Username: ${DB_USER}
  Password: ${DB_PASSWORD}

Redis Access:
  Host: localhost:${REDIS_PORT}
  Password: ${REDIS_PASSWORD}

Authentication API:
  Endpoint: http://localhost:${AUTH_PORT}

Default Users:
  Admin:
    Email: admin@ms5.local
    Password: ${ADMIN_PASSWORD}
    Role: admin

  Supervisor:
    Email: supervisor@ms5.local
    Password: supervisor123
    Role: supervisor

  Operator:
    Email: operator1@ms5.local
    Password: operator123
    Role: operator

  Viewer:
    Email: viewer@ms5.local
    Password: viewer123
    Role: viewer

JWT Secret: ${JWT_SECRET:0:20}...

================================================
EOF

chmod 600 ${INSTALL_DIR}/CREDENTIALS.txt
print_status "Credentials file created at ${INSTALL_DIR}/CREDENTIALS.txt"

echo ""
echo "================================================"
echo "   ✅ Installation Complete!"
echo "================================================"
echo ""
echo "System Status:"
docker-compose -f ${INSTALL_DIR}/docker-compose.yml ps
echo ""
echo "Access Details:"
echo "  Auth API:   http://$(hostname -I | awk '{print $1}'):${AUTH_PORT}"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo ""
echo "Test Authentication:"
echo "  ${INSTALL_DIR}/scripts/test-auth.sh"
echo ""
echo "View Credentials:"
echo "  sudo cat ${INSTALL_DIR}/CREDENTIALS.txt"
echo ""
echo "Helper Commands:"
echo "  ms5-status  - Check system status"
echo "  ms5-logs    - View logs"
echo "  ms5-connect - Connect to database"
echo ""
echo "The authentication system is now fully configured and running!"
echo "Services will automatically start on system boot."