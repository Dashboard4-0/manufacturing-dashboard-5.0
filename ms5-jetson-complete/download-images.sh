#!/bin/bash

echo "Downloading Docker images for offline use..."
echo "This requires internet connection!"
echo ""

mkdir -p docker

# Pull and save images
echo "1. Pulling PostgreSQL 12..."
docker pull postgres:12
docker save postgres:12 > docker/postgres.tar

echo "2. Pulling Redis..."
docker pull redis:7-alpine
docker save redis:7-alpine > docker/redis.tar

echo "3. Pulling Node.js..."
docker pull node:20-slim
docker save node:20-slim > docker/node.tar

echo ""
echo "Docker images saved to docker/ directory"
echo "Total size: $(du -sh docker | cut -f1)"
