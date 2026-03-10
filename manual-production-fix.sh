#!/bin/bash

# Manual production fix without Docker Compose build issues
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Manual production fix..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to backend directory ==="
cd /home/ec2-user/backend

echo "=== Stop all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Build app image manually ==="
docker build -t backend-app .

echo "=== Start Redis ==="
docker run -d --name backend-redis -p 6379:6379 -v redis_data:/data redis:7-alpine redis-server --appendonly yes

echo "=== Start MongoDB ==="
docker run -d --name backend-mongodb -p 27017:27017 -v mongodb_data:/data/db -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password123 mongo:7

echo "=== Start App ==="
docker run -d --name backend-app -p 3000:3000 \
  --link backend-redis:redis \
  --link backend-mongodb:mongodb \
  -v $(pwd)/certs:/app/certs:ro \
  -v $(pwd)/uploads:/app/uploads \
  -e NODE_ENV=production \
  -e REDIS_URL=redis://redis:6379 \
  -e MONGODB_URI=mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin \
  backend-app

echo "=== Wait for services to start ==="
sleep 20

echo "=== Check container status ==="
docker ps

echo "=== Test Redis connection ==="
docker exec backend-app node -e "
const redis = require('./config/redis');
redis.connect().then(() => {
  console.log('✅ Redis connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ Redis connection failed:', err.message);
  process.exit(1);
});
"

echo "=== Test MongoDB connection ==="
docker exec backend-app node -e "
const mongoose = require('mongoose');
mongoose.connect('mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin').then(() => {
  console.log('✅ MongoDB connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  process.exit(1);
});
"

echo "=== Test API endpoints ==="
curl http://localhost:3000/
curl http://localhost:3000/api/ping

echo "=== Show app logs ==="
docker logs backend-app --tail 20
EOF

echo "✅ Manual production fix complete!"
