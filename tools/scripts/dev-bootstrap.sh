#!/bin/bash
set -euo pipefail

echo "🚀 MS5.0 Development Environment Bootstrap"
echo "=========================================="

# Check prerequisites
echo "📋 Checking prerequisites..."

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo "❌ $1 is not installed. Please install $1 first."
    exit 1
  else
    echo "✅ $1 is installed"
  fi
}

check_command docker
check_command docker-compose
check_command node
check_command pnpm

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js version must be 20 or higher. Current version: $(node -v)"
  exit 1
fi
echo "✅ Node.js version: $(node -v)"

# Check pnpm version
echo "✅ pnpm version: $(pnpm -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
pnpm install

# Start Docker services
echo ""
echo "🐳 Starting Docker services..."
docker-compose up -d

# Wait for services to be healthy
echo ""
echo "⏳ Waiting for services to be healthy..."

wait_for_service() {
  local service=$1
  local max_attempts=30
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if docker-compose ps | grep "$service" | grep -q "healthy\|Up"; then
      echo "✅ $service is ready"
      return 0
    fi
    echo "⏳ Waiting for $service... (attempt $((attempt + 1))/$max_attempts)"
    sleep 2
    attempt=$((attempt + 1))
  done

  echo "❌ $service failed to start"
  return 1
}

wait_for_service postgres
wait_for_service timescale
wait_for_service kafka
wait_for_service minio
wait_for_service opensearch
wait_for_service vault
wait_for_service redis

# Create Kafka topics
echo ""
echo "📨 Creating Kafka topics..."
make kafka-topics || true

# Create MinIO buckets
echo ""
echo "🗂️ Creating MinIO buckets..."
make minio-buckets || true

# Run database migrations
echo ""
echo "🗄️ Running database migrations..."
./tools/scripts/db-migrate.sh

# Seed database
echo ""
echo "🌱 Seeding database..."
./tools/scripts/seed.sh

# Setup Vault
echo ""
echo "🔐 Setting up Vault..."
docker-compose exec -T vault vault auth enable userpass || true
docker-compose exec -T vault vault policy write ms5-policy - <<EOF
path "secret/data/ms5/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
EOF

docker-compose exec -T vault vault kv put secret/ms5/common \
  jwt_secret="dev-jwt-secret-change-in-production" \
  database_encryption_key="dev-encryption-key-change-in-production" \
  api_key="dev-api-key-change-in-production"

# Setup OpenSearch indices
echo ""
echo "🔍 Setting up OpenSearch indices..."
curl -X PUT "http://localhost:9200/ms5-logs" -H 'Content-Type: application/json' -d '{
  "settings": {
    "number_of_shards": 2,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "service": { "type": "keyword" },
      "level": { "type": "keyword" },
      "message": { "type": "text" },
      "traceId": { "type": "keyword" },
      "spanId": { "type": "keyword" }
    }
  }
}' 2>/dev/null || true

curl -X PUT "http://localhost:9200/ms5-audit" -H 'Content-Type: application/json' -d '{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "timestamp": { "type": "date" },
      "userId": { "type": "keyword" },
      "action": { "type": "keyword" },
      "resource": { "type": "keyword" },
      "result": { "type": "keyword" },
      "metadata": { "type": "object" }
    }
  }
}' 2>/dev/null || true

# Build shared libraries
echo ""
echo "🔨 Building shared libraries..."
pnpm --filter @ms5/shared build

# Generate TypeScript types for Prisma
echo ""
echo "🎯 Generating Prisma types..."
for service in services/*/; do
  if [ -f "$service/prisma/schema.prisma" ]; then
    echo "Generating types for $(basename "$service")..."
    (cd "$service" && npx prisma generate) || true
  fi
done

echo ""
echo "✅ Bootstrap complete!"
echo ""
echo "📝 Next steps:"
echo "  1. Run 'make dev' to start the development servers"
echo "  2. Access the services:"
echo "     - API Gateway: http://localhost:3000"
echo "     - GraphQL Playground: http://localhost:3000/graphql"
echo "     - MinIO Console: http://localhost:9001 (minioadmin/minioadmin123)"
echo "     - OpenSearch Dashboards: http://localhost:5601"
echo "     - Grafana: http://localhost:3999 (admin/admin123)"
echo "     - Vault UI: http://localhost:8200 (Token: root-token-dev)"
echo ""
echo "🎉 Happy coding!"