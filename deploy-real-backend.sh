#!/bin/bash

# Deploy the real production backend
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🚀 Deploying real production backend..."

# First, copy the real backend files
scp -i $KEY_FILE -r app.js routes utils config models services controllers package.json package-lock.json .env ec2-user@$EC2_IP:/home/ec2-user/crowd-teach-gogrowsmart-backend/

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to project ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend

echo "=== Create production Dockerfile ==="
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

echo "=== Create production docker-compose.yml ==="
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

echo "=== Stop and rebuild containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Build and start production services ==="
docker-compose up -d --build

echo "=== Wait for services to start ==="
sleep 20

echo "=== Check status ==="
docker-compose ps

echo "=== Test root endpoint ==="
curl http://localhost:3000/

echo "=== Test API ping ==="
curl http://localhost:3000/api/ping

echo "=== Show app logs ==="
docker-compose logs app --tail 20
EOF

echo "✅ Real backend deployment complete!"
