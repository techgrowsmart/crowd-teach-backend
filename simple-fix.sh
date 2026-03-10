#!/bin/bash

# Simple fix for Redis Docker issue on EC2
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Simple Redis Docker fix for EC2..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Create project directory ==="
cd /home/ec2-user
mkdir -p crowd-teach-gogrowsmart-backend
cd crowd-teach-gogrowsmart-backend

echo "=== Create basic Dockerfile ==="
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

echo "=== Create package.json ==="
cat > package.json << 'EOL'
{
  "name": "crowd-teach-gogrowsmart-backend",
  "version": "1.0.0",
  "main": "app.js",
  "scripts": {
    "start": "node app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "redis": "^4.6.0",
    "cassandra-driver": "^4.6.0",
    "multer": "^1.4.5",
    "dotenv": "^16.0.0"
  }
}
EOL

echo "=== Create basic app.js ==="
cat > app.js << 'EOL'
require("dotenv").config();
const express = require("express");
const redis = require('./config/redis');

const app = express();
app.use(express.json());

// Basic Redis test
app.get('/api/ping', async (req, res) => {
  try {
    await redis.connect();
    await redis.raw().set('test', 'working');
    const value = await redis.raw().get('test');
    res.json({ 
      status: 'ok', 
      redis: value === 'working' ? 'connected' : 'failed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      redis: 'failed',
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
EOL

echo "=== Create redis config ==="
mkdir -p config
cat > config/redis.js << 'EOL'
const { createClient } = require('redis');

let _client = null;

async function _initClient() {
  if (_client) return _client;
  
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  _client = createClient({ url });

  _client.on('error', (err) => {
    console.error('Redis client error:', err.message);
  });
  _client.on('connect', () => {
    console.log('🔌 Redis client connected');
  });

  return _client;
}

const redisWrapper = {
  isOpen: false,
  
  connect: async function () {
    const client = await _initClient();
    if (!client.isOpen) {
      await client.connect();
    }
    this.isOpen = !!client.isOpen;
    return true;
  },
  
  raw: function () {
    return _client;
  }
};

module.exports = redisWrapper;
EOL

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

echo "=== Install docker-compose ==="
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

echo "=== Build and start services ==="
docker-compose up -d --build

echo "=== Wait for services to start ==="
sleep 15

echo "=== Check status ==="
docker-compose ps

echo "=== Show logs ==="
docker-compose logs

echo "=== Test API ==="
curl -f http://localhost:3000/api/ping

echo "=== Show container status ==="
docker ps
EOF

echo "✅ Simple fix complete!"
