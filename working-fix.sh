#!/bin/bash

# Working fix for Redis Docker issue on EC2 with older Docker
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Working Redis Docker fix for EC2..."

# Copy the project files
scp -i $KEY_FILE -r . ec2-user@$EC2_IP:/home/ec2-user/crowd-teach-gogrowsmart-backend-temp/

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Clean up and setup project ==="
cd /home/ec2-user
sudo rm -rf crowd-teach-gogrowsmart-backend
mv crowd-teach-gogrowsmart-backend-temp crowd-teach-gogrowsmart-backend
cd crowd-teach-gogrowsmart-backend

echo "=== Create docker-compose.yml ==="
cat > docker-compose.yml << 'EOL'
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
    env_file:
      - .env
    volumes:
      - ./certs:/app/certs:ro
    depends_on:
      - redis
    restart: unless-stopped
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - app-network
    command: redis-server --appendonly yes

volumes:
  redis_data:

networks:
  app-network:
    driver: bridge
EOL

echo "=== Stop all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Install docker-compose if not present ==="
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

echo "=== Build and start services ==="
docker-compose up -d --build

echo "=== Wait for services to start ==="
sleep 20

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

echo "=== Show container status ==="
docker ps

echo "=== Show network connections ==="
netstat -tlnp | grep -E ':(3000|6379)' || echo "No ports found"
EOF

echo "✅ Working fix complete!"
