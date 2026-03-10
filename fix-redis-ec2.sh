#!/bin/bash

# Fix Redis Docker Issue on EC2
EC2_IP="16.171.57.134"
KEY_FILE="gogrowsmart-key.pem"

echo "🔧 Fixing Redis Docker setup on EC2..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Stopping all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Cleaning up old containers ==="
docker system prune -f

echo "=== Navigate to project directory ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend

echo "=== Check if docker-compose.yml exists ==="
ls -la docker-compose.yml

echo "=== Start services with docker-compose ==="
docker-compose up -d --build

echo "=== Check new status ==="
docker-compose ps
docker-compose logs

echo "=== Test Redis connection ==="
docker-compose exec app node -e "
const redis = require('./config/redis');
redis.connect().then(() => {
  console.log('✅ Redis connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ Redis connection failed:', err.message);
  process.exit(1);
});
"
EOF

echo "✅ Redis fix attempt complete"
