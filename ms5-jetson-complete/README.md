# MS5.0 Manufacturing System - Jetson Offline Installation

## Quick Start

### On a machine with internet:

```bash
# Download Docker images for offline use
./download-images.sh
```

### On your Jetson (offline):

```bash
# Install
sudo ./install.sh

# Wait 60 seconds, then test
ms5-test
```

## Troubleshooting

### If you get "version unsupported" error:

The docker-compose.yml uses version 3.3 which is compatible with docker-compose 1.25

### If database connection fails:

1. Check if PostgreSQL container is running:

   ```bash
   docker ps | grep postgres
   ```

2. Check PostgreSQL logs:

   ```bash
   docker logs ms5-postgres
   ```

3. Restart services:
   ```bash
   cd /opt/ms5
   docker-compose down
   docker-compose up -d
   ```

### Test the API:

```bash
# Health check
curl http://localhost:4000/health

# Get metrics
curl http://localhost:4000/api/v2/metrics
```

## System Requirements

- Docker 20.10+
- Docker Compose 1.25+
- 4GB RAM minimum
- 10GB disk space

## Support Commands

- `ms5-status` - Check all services
- `ms5-logs [service]` - View logs
- `ms5-restart` - Restart all services
- `ms5-test` - Test API endpoints
