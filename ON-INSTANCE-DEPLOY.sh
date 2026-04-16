#!/bin/bash
# Run these commands IN the Session Manager terminal

set -e

echo "=========================================="
echo "GROWSMART DEPLOYMENT - Run on EC2"
echo "=========================================="

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum update -y
    sudo yum install -y docker
    sudo service docker start
    sudo usermod -aG docker $USER
fi

# Install docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo "Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Start Docker
sudo service docker start

# Create app directory
mkdir -p ~/growsmart-backend
cd ~/growsmart-backend

# Download deployment package from S3 (you'll upload it there)
echo "Please upload the deployment package first:"
echo "From your local machine run:"
echo "  aws s3 cp new-ec2-deploy.tar.gz s3://your-bucket/"
echo "  OR use Session Manager file transfer"

# Alternative: Create files manually
echo "Creating configuration files..."

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  app:
    image: node:20-alpine
    container_name: growsmart-backend
    working_dir: /app
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - USE_LOCAL_DB=true
      - LOCAL_REDIS_URL=redis://redis:6379
      - REDIS_URL=redis://redis:6379
      - MONGO_DB_URL=mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin
    volumes:
      - ./:/app
    depends_on:
      - redis
      - mongodb
    command: sh -c "npm install --production && node app.js"
    restart: unless-stopped
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    container_name: growsmart-redis
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - app-network
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru

  mongodb:
    image: mongo:7
    container_name: growsmart-mongodb
    ports:
      - "127.0.0.1:27017:27017"
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password123
      - MONGO_INITDB_DATABASE=gogrowsmart
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped
    networks:
      - app-network

volumes:
  redis_data:
  mongodb_data:

networks:
  app-network:
    driver: bridge
EOF

echo "✅ docker-compose.yml created"
echo ""
echo "=========================================="
echo "NEXT STEPS:"
echo "=========================================="
echo "1. Upload your backend files to ~/growsmart-backend/"
echo "   - app.js"
echo "   - package.json"
echo "   - config/ folder"
echo "   - routes/ folder"
echo "   - .env.production"
echo ""
echo "2. Then run: docker-compose up -d"
echo ""
echo "3. Test: curl http://localhost:3000/api/ping"
echo "=========================================="
