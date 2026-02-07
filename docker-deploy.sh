#!/bin/bash

echo "🐳 Deploying GoGrowSmart Backend with Docker..."

# Stop existing PM2 processes
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Stop any existing containers
docker stop gogrowsmart-backend 2>/dev/null || true
docker rm gogrowsmart-backend 2>/dev/null || true
docker stop gogrowsmart-redis 2>/dev/null || true
docker rm gogrowsmart-redis 2>/dev/null || true

# Create network
docker network create gogrowsmart-network 2>/dev/null || true

# Build backend image
echo "📦 Building backend image..."
docker build -f Dockerfile.prod -t gogrowsmart-backend:latest .

# Run Redis container
echo "🔄 Starting Redis..."
docker run -d \
  --name gogrowsmart-redis \
  --network gogrowsmart-network \
  -p 6379:6379 \
  redis:7-alpine

# Run backend container
echo "🚀 Starting backend..."
docker run -d \
  --name gogrowsmart-backend \
  --network gogrowsmart-network \
  -p 443:443 \
  -v $(pwd)/certs:/home/ec2-user/certs \
  -v $(pwd)/uploads:/app/uploads \
  --env-file .env \
  gogrowsmart-backend:latest

# Wait for containers to start
sleep 10

# Check status
echo "📊 Checking container status..."
docker ps

# Test backend
echo "🧪 Testing backend..."
sleep 5
curl -k https://localhost:443/api/ping

echo "✅ Deployment complete!"
echo "🌐 Server available at: https://growsmartserver.gogrowsmart.com"
echo ""
echo "📋 Useful commands:"
echo "  View logs: docker logs gogrowsmart-backend"
echo "  Stop: docker stop gogrowsmart-backend"
echo "  Restart: docker restart gogrowsmart-backend"
