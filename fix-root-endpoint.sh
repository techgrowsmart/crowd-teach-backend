#!/bin/bash

# Fix root endpoint for the production server
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Fix root endpoint on EC2..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to project ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend

echo "=== Update app.js with root endpoint ==="
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

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'GoGrowSmart Backend API',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

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

echo "=== Rebuild and restart app container ==="
docker stop crowd-app
docker rm crowd-app
docker build -t crowd-app .
docker run -d --name crowd-app -p 3000:3000 --link crowd-redis:redis -e REDIS_URL=redis://redis:6379 crowd-app

echo "=== Wait for container to start ==="
sleep 10

echo "=== Test root endpoint ==="
curl -i http://localhost:3000/

echo "=== Test API endpoint ==="
curl -i http://localhost:3000/api/ping

echo "=== Show container status ==="
docker ps

echo "=== Show app logs ==="
docker logs crowd-app --tail 10
EOF

echo "✅ Root endpoint fix complete!"
