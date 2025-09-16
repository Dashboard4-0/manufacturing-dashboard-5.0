#!/bin/bash

# MS5.0 Deployment Script - Transfer and Install on Ubuntu

echo "================================================"
echo "   MS5.0 Deployment to Ubuntu System"
echo "================================================"
echo ""

# Check if target host is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <user@ubuntu-host>"
    echo "Example: $0 ubuntu@192.168.1.100"
    exit 1
fi

TARGET=$1

echo "📦 Packaging installation files..."

# Create deployment package
mkdir -p ms5-ubuntu-deploy
cp ubuntu-ms5-complete-auth.sh ms5-ubuntu-deploy/install.sh
chmod +x ms5-ubuntu-deploy/install.sh

echo ""
echo "📤 Transferring to $TARGET..."
scp -r ms5-ubuntu-deploy/* $TARGET:/tmp/

echo ""
echo "🚀 Starting remote installation..."
ssh $TARGET "sudo bash /tmp/install.sh"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "To check the installation status, run:"
echo "  ssh $TARGET 'ms5-status'"
echo ""
echo "To view credentials, run:"
echo "  ssh $TARGET 'sudo cat /opt/ms5/CREDENTIALS.txt'"

# Cleanup
rm -rf ms5-ubuntu-deploy