#!/bin/bash

# Deploy with proper docker-compose setup
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🚀 Deploying with docker-compose to EC2..."

# First, copy the docker-compose.yml file to EC2
scp -i $KEY_FILE docker-compose.yml ec2-user@$EC2_IP:/home/ec2-user/crowd-teach-gogrowsmart-backend/

# Then run deployment commands
ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to project directory ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend

echo "=== Verify docker-compose.yml exists ==="
ls -la docker-compose.yml

echo "=== Stop any running containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Start with docker-compose ==="
docker-compose up -d --build

echo "=== Check status ==="
docker-compose ps

echo "=== Show logs ==="
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

echo "=== Test API endpoint ==="
curl -f http://localhost:3000/api/ping || echo "API test failed"
EOF

echo "✅ Deployment complete!"
