#!/bin/bash

# Final working fix for Redis Docker issue on EC2
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Final working Redis Docker fix for EC2..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Create project directory ==="
cd /home/ec2-user
mkdir -p crowd-teach-gogrowsmart-backend
cd crowd-teach-gogrowsmart-backend

echo "=== Create simple Dockerfile ==="
cat > Dockerfile << 'EOL'
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Install pm2
RUN npm install -g pm2

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
    "redis": "^4.6.0",
    "dotenv": "^16.0.0"
  }
}
EOL

echo "=== Create basic app.js ==="
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
  console.log(\`Server running on port \${PORT}\`);
});
EOL

echo "=== Create docker-compose.yml ==="
cat > docker-compose.yml << 'EOL'
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

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    command: redis-server --appendonly yes

volumes:
  redis_data:
EOL

echo "=== Stop all containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Build and start services manually ==="
# Build app image
docker build -t crowd-app .

# Run Redis
docker run -d --name crowd-redis -p 6379:6379 -v redis_data:/data redis:7-alpine redis-server --appendonly yes

# Run app
docker run -d --name crowd-app -p 3000:3000 --link crowd-redis:redis -e REDIS_URL=redis://redis:6379 crowd-app

echo "=== Wait for services to start ==="
sleep 10

echo "=== Check container status ==="
docker ps

echo "=== Test Redis connection ==="
docker exec crowd-app node -e "
const { createClient } = require('redis');
const client = createClient({ url: 'redis://redis:6379' });
client.connect().then(() => {
  console.log('✅ Redis connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ Redis connection failed:', err.message);
  process.exit(1);
});
"

echo "=== Test API ==="
curl -f http://localhost:3000/api/ping || echo "API test failed"

echo "=== Show logs ==="
docker logs crowd-app
EOF

echo "✅ Final working fix complete!"
