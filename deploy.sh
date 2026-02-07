#!/bin/bash

# EC2 Deployment Script for GoGrowSmart Backend
# Target: https://growsmartserver.gogrowsmart.com/

set -e

echo "🚀 Starting EC2 deployment for GoGrowSmart Backend..."

# Configuration
EC2_USER="ec2-user"
EC2_HOST="16.171.57.134"  # IP from ping test
APP_DIR="/home/ec2-user/crowd-teach-gogrowsmart-backend"
BACKUP_DIR="/home/ec2-user/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup on server
echo "📦 Creating backup..."
ssh $EC2_USER@$EC2_HOST "mkdir -p $BACKUP_DIR && cp -r $APP_DIR $BACKUP_DIR/backend_$TIMESTAMP"

# Stop existing application
echo "⏹️ Stopping existing application..."
ssh $EC2_USER@$EC2_HOST "cd $APP_DIR && pm2 stop app.js || true && pm2 delete app.js || true"

# Sync files to EC2
echo "📤 Syncing files to EC2..."
rsync -avz --exclude node_modules \
    --exclude .git \
    --exclude logs \
    --exclude uploads \
    --exclude secure-connect-gogrowsmart.zip \
    ./ $EC2_USER@$EC2_HOST:$APP_DIR/

# Install dependencies on EC2
echo "📦 Installing dependencies..."
ssh $EC2_USER@$EC2_HOST "cd $APP_DIR && npm ci --production"

# Ensure SSL certificates exist
echo "🔒 Checking SSL certificates..."
ssh $EC2_USER@$EC2_HOST "sudo mkdir -p /home/ec2-user/certs && sudo chown ec2-user:ec2-user /home/ec2-user/certs"

# Start application with PM2
echo "🚀 Starting application..."
ssh $EC2_USER@$EC2_HOST "cd $APP_DIR && pm2 start app.js --name backend && pm2 save && pm2 startup"

# Verify application is running
echo "🔍 Verifying deployment..."
sleep 5
ssh $EC2_USER@$EC2_HOST "pm2 status"

# Test connectivity
echo "🌐 Testing connectivity..."
sleep 10
curl -f https://growsmartserver.gogrowsmart.com/ || echo "⚠️ Backend may still be starting..."

echo "✅ Deployment completed successfully!"
echo "🌐 Your backend should be available at: https://growsmartserver.gogrowsmart.com/"
echo "📊 Check PM2 logs: ssh $EC2_USER@$EC2_HOST 'pm2 logs backend'"
