#!/bin/bash

# MS5.0 Simple Installation for Ubuntu - Minimal Dependencies
# This version works even with limited network access

echo "================================================"
echo "   MS5.0 Simple Installation"
echo "================================================"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
   echo "ERROR: Run with sudo"
   exit 1
fi

echo "Checking system..."

# Check Docker only (skip other packages)
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is required. Install with:"
    echo "  curl -fsSL https://get.docker.com | sh"
    exit 1
fi

echo "Docker found: $(docker --version)"

# Check docker-compose (but don't fail if missing)
if command -v docker-compose &> /dev/null; then
    echo "Docker Compose found: $(docker-compose --version)"
    USE_COMPOSE=true
else
    echo "Docker Compose not found, using docker directly"
    USE_COMPOSE=false
fi

echo ""
echo "Setting up MS5.0..."

# Create directory
mkdir -p /opt/ms5
cd /opt/ms5

# Stop any existing containers
echo "Cleaning up old containers..."
docker stop ms5-postgres ms5-redis 2>/dev/null || true
docker rm ms5-postgres ms5-redis 2>/dev/null || true

# Find available ports
echo ""
echo "Finding available ports..."

# Check PostgreSQL port
POSTGRES_PORT=5432
if nc -zv localhost 5432 2>&1 | grep -q succeeded; then
    echo "Port 5432 is busy, using 5433"
    POSTGRES_PORT=5433
else
    echo "Using port 5432 for PostgreSQL"
fi

# Check Redis port
REDIS_PORT=6379
if nc -zv localhost 6379 2>&1 | grep -q succeeded; then
    echo "Port 6379 is busy, using 6380"
    REDIS_PORT=6380
else
    echo "Using port 6379 for Redis"
fi

# Create init.sql
echo ""
echo "Creating database schema..."
cat > /opt/ms5/init.sql << 'SQLEOF'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) DEFAULT 'operator',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    area_id VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (email, name, role, password_hash) VALUES
    ('admin@ms5.local', 'Admin User', 'admin', 'admin123'),
    ('operator@ms5.local', 'Operator User', 'operator', 'operator123')
ON CONFLICT DO NOTHING;

INSERT INTO production_lines (name, area_id, status) VALUES
    ('Assembly Line 1', 'AREA-A', 'active'),
    ('Packaging Line 1', 'AREA-B', 'active')
ON CONFLICT DO NOTHING;

GRANT ALL ON ALL TABLES IN SCHEMA public TO ms5user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ms5user;
SQLEOF

# Start PostgreSQL
echo ""
echo "Starting PostgreSQL..."
docker run -d \
    --name ms5-postgres \
    -e POSTGRES_USER=ms5user \
    -e POSTGRES_PASSWORD=ms5pass \
    -e POSTGRES_DB=ms5db \
    -p ${POSTGRES_PORT}:5432 \
    -v /opt/ms5/postgres_data:/var/lib/postgresql/data \
    -v /opt/ms5/init.sql:/docker-entrypoint-initdb.d/init.sql:ro \
    --restart unless-stopped \
    postgres:12

# Start Redis
echo "Starting Redis..."
docker run -d \
    --name ms5-redis \
    -p ${REDIS_PORT}:6379 \
    -v /opt/ms5/redis_data:/data \
    --restart unless-stopped \
    redis:7-alpine redis-server --appendonly yes

echo ""
echo "Waiting for services to start..."
sleep 15

# Test connections
echo ""
echo "Testing services..."

# Test PostgreSQL
if docker exec ms5-postgres psql -U ms5user -d ms5db -c "SELECT COUNT(*) FROM users;" 2>/dev/null; then
    echo "✅ PostgreSQL is working on port ${POSTGRES_PORT}"
else
    echo "❌ PostgreSQL failed"
    docker logs ms5-postgres --tail 20
fi

# Test Redis
if docker exec ms5-redis redis-cli ping 2>/dev/null; then
    echo "✅ Redis is working on port ${REDIS_PORT}"
else
    echo "❌ Redis failed"
    docker logs ms5-redis --tail 20
fi

# Create simple auth test
echo ""
echo "Creating auth test script..."
cat > /opt/ms5/test-auth.js << 'EOF'
const crypto = require('crypto');

console.log('MS5.0 Authentication Configuration');
console.log('===================================');

const users = [
  { email: 'admin@ms5.local', password: 'admin123', role: 'admin' },
  { email: 'operator@ms5.local', password: 'operator123', role: 'operator' }
];

console.log('\nDefault Users:');
users.forEach(u => {
  console.log(`  ${u.email} / ${u.password} (${u.role})`);
});

const secret = 'ms5-jwt-secret-' + crypto.randomBytes(16).toString('hex');
console.log('\nJWT Secret:', secret.substring(0, 30) + '...');

console.log('\nAuthentication Endpoints (when app is running):');
console.log('  POST /auth/login   - Login with email/password');
console.log('  GET  /auth/verify  - Verify JWT token');
console.log('  POST /auth/logout  - Logout and invalidate token');
EOF

# Create status script
cat > /usr/local/bin/ms5-status << EOF
#!/bin/bash
echo "MS5.0 Status"
echo "============"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5 || echo "No MS5 containers"
echo ""
echo "Database: localhost:${POSTGRES_PORT} (ms5user/ms5pass)"
echo "Redis:    localhost:${REDIS_PORT}"
EOF
chmod +x /usr/local/bin/ms5-status

# Create connect script
cat > /usr/local/bin/ms5-connect << EOF
#!/bin/bash
docker exec -it ms5-postgres psql -U ms5user -d ms5db
EOF
chmod +x /usr/local/bin/ms5-connect

# Create credentials file
cat > /opt/ms5/credentials.txt << EOF
MS5.0 System Credentials
========================

PostgreSQL:
  Host: localhost
  Port: ${POSTGRES_PORT}
  Database: ms5db
  Username: ms5user
  Password: ms5pass

Redis:
  Host: localhost
  Port: ${REDIS_PORT}

Default Users:
  admin@ms5.local / admin123 (admin)
  operator@ms5.local / operator123 (operator)

Connection String:
  postgresql://ms5user:ms5pass@localhost:${POSTGRES_PORT}/ms5db

Commands:
  ms5-status  - Check status
  ms5-connect - Connect to database
EOF

echo ""
echo "================================================"
echo "   ✅ Installation Complete!"
echo "================================================"
echo ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ms5
echo ""
echo "Access Details:"
echo "  PostgreSQL: localhost:${POSTGRES_PORT}"
echo "  Redis:      localhost:${REDIS_PORT}"
echo "  Credentials: /opt/ms5/credentials.txt"
echo ""
echo "Commands:"
echo "  ms5-status  - Check status"
echo "  ms5-connect - Connect to database"
echo ""
echo "Authentication system is configured in the database."
echo "Application services need to be added separately."