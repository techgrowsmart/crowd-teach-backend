#!/bin/bash

# Corrected fix for Redis Docker issue on EC2
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Corrected Redis Docker fix for EC2..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Stop all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Create project directory ==="
cd /home/ec2-user
mkdir -p crowd-teach-gogrowsmart-backend
cd crowd-teach-gogrowsmart-backend

echo "=== Create correct app.js ==="
cat > app.js << 'EOL'
require("dotenv").config();
const express = require("express");
const { createClient } = require('redis');

const app = express();
app.use(express.json());

// Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Redis Connected');
});

// Connect to Redis
redisClient.connect();

// Basic Redis test
app.get('/api/ping', async (req, res) => {
  try {
    await redisClient.set('test', 'working');
    const value = await redisClient.get('test');
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
  console.log('Server running on port ' + PORT);
});
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
    "redis": "^4.6.0",
    "dotenv": "^16.0.0"
  }
}
EOL

echo "=== Create Dockerfile ==="
cat > Dockerfile << 'EOL'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm install -g pm2

EXPOSE 3000

CMD ["pm2-runtime", "app.js"]
EOL

echo "=== Build and run containers ==="
docker build -t crowd-app .

# Run Redis
docker run -d --name crowd-redis -p 6379:6379 -v redis_data:/data redis:7-alpine redis-server --appendonly yes

# Run app
docker run -d --name crowd-app -p 3000:3000 --link crowd-redis:redis -e REDIS_URL=redis://redis:6379 crowd-app

echo "=== Wait for services ==="
sleep 10

echo "=== Check containers ==="
docker ps

echo "=== Test API ==="
curl http://localhost:3000/api/ping

echo "=== Show logs ==="
docker logs crowd-app --tail 20
EOF

echo "✅ Corrected fix complete!"
