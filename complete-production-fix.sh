#!/bin/bash

# Complete production fix for Redis, MongoDB, AstraDB, SSL with Docker Compose
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🚀 Complete production fix for backend..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to correct backend directory ==="
cd /home/ec2-user/backend

echo "=== Check current files ==="
ls -la

echo "=== Update docker-compose.yml with all services ==="
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
      - ./uploads:/app/uploads
    depends_on:
      - redis
      - mongodb
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

  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped
    networks:
      - app-network
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password123

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - app-network

volumes:
  redis_data:
  mongodb_data:

networks:
  app-network:
    driver: bridge
EOL

echo "=== Update Dockerfile for production ==="
cat > Dockerfile << 'EOL'
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy app source
COPY . .

# Install pm2
RUN npm install -g pm2

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

CMD ["pm2-runtime", "app.js"]
EOL

echo "=== Create nginx.conf for SSL termination ==="
cat > nginx.conf << 'EOL'
events {
    worker_connections 1024;
}

http {
    upstream app {
        server app:3000;
    }

    # HTTP redirect to HTTPS
    server {
        listen 80;
        server_name growsmartserver.gogrowsmart.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name growsmartserver.gogrowsmart.com;

        ssl_certificate /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        location / {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
EOL

echo "=== Check if .env exists ==="
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << 'EOL'
NODE_ENV=production
PORT=3000
REDIS_URL=redis://redis:6379
MONGODB_URI=mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin
EOL
fi

echo "=== Stop all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Build and start all services ==="
docker-compose up -d --build

echo "=== Wait for services to start ==="
sleep 30

echo "=== Check service status ==="
docker-compose ps

echo "=== Check logs ==="
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

echo "=== Test MongoDB connection ==="
docker-compose exec app node -e "
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
curl -k http://localhost:3000/
curl -k http://localhost:3000/api/ping

echo "=== Show container status ==="
docker ps
EOF

echo "✅ Complete production fix finished!"
