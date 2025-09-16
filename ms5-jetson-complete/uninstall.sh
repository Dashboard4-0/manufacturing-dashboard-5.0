#!/bin/bash

echo "Uninstalling MS5.0 Manufacturing System..."

if [ "$EUID" -ne 0 ]; then
   echo "Please run with sudo"
   exit 1
fi

# Stop services
systemctl stop ms5 2>/dev/null
systemctl disable ms5 2>/dev/null
cd /opt/ms5 && docker-compose down -v 2>/dev/null

# Remove containers and images
docker rm -f ms5-postgres ms5-redis ms5-app 2>/dev/null
docker rmi postgres:12 redis:7-alpine node:20-slim 2>/dev/null

# Remove files
rm -rf /opt/ms5
rm -rf /var/log/ms5
rm -f /etc/systemd/system/ms5.service
rm -f /usr/local/bin/ms5-*

echo "Uninstallation complete"
