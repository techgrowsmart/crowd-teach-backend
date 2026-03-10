#!/bin/bash

# Quick fix to get the real backend running
EC2_IP="3.95.195.41"
KEY_FILE="growsmart-key.pem"

echo "🔧 Quick fix for real backend..."

ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Navigate to project ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend

echo "=== Check if files exist ==="
ls -la app.js .env package.json

echo "=== Stop containers ==="
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

echo "=== Install dependencies ==="
npm install --production

echo "=== Run app directly with Node.js (not Docker) ==="
NODE_ENV=production REDIS_URL=redis://127.0.0.1:6379 nohup node app.js > app.log 2>&1 &

echo "=== Start Redis container ==="
docker run -d --name crowd-redis -p 6379:6379 -v redis_data:/data redis:7-alpine redis-server --appendonly yes

echo "=== Wait for app to start ==="
sleep 10

echo "=== Test root endpoint ==="
curl http://localhost:3000/

echo "=== Test API ping ==="
curl http://localhost:3000/api/ping

echo "=== Check if app is running ==="
ps aux | grep node

echo "=== Show app logs ==="
tail -20 app.log
EOF

echo "✅ Quick fix complete!"
