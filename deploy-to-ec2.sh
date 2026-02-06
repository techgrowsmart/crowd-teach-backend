#!/bin/bash

echo "🚀 Starting deployment to EC2 server..."

# EC2 Server Configuration
EC2_USER="ec2-user"
EC2_HOST="growsmartserver.gogrowsmart.com"  # Update with your actual EC2 domain/IP
BACKEND_PATH="/home/ec2-user/crowd-teach-gogrowsmart-backend"  # Update with actual path on server

echo "📡 Connecting to EC2 server: $EC2_HOST"

# SSH commands to execute on EC2 server
ssh -o StrictHostKeyChecking=no $EC2_USER@$EC2_HOST << 'EOF'

echo "📍 Current directory: $(pwd)"
echo "🔍 Checking if backend directory exists..."

# Navigate to backend directory
cd crowd-teach-gogrowsmart-backend 2>/dev/null || cd /home/ec2-user/crowd-teach-gogrowsmart-backend 2>/dev/null || cd /var/www/crowd-teach-gogrowsmart-backend 2>/dev/null || {
    echo "❌ Backend directory not found. Please check the path."
    exit 1
}

echo "📍 Changed to: $(pwd)"
echo "🔍 Current Git status:"
git status

echo ""
echo "📥 Pulling latest changes from GitHub..."
git pull origin main

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔍 Checking PM2 status..."
pm2 status

echo ""
echo "🔄 Restarting application..."
pm2 restart app.js || pm2 restart all || {
    echo "⚠️  PM2 restart failed, trying alternative methods..."
    
    # Try with docker-compose if PM2 fails
    if [ -f "docker-compose.yml" ]; then
        echo "🐳 Using Docker Compose..."
        docker-compose down
        docker-compose up -d --build
    elif [ -f "package.json" ]; then
        echo "📦 Starting with Node.js directly..."
        pkill -f "node.*app.js" || true
        nohup node app.js > app.log 2>&1 &
    fi
}

echo ""
echo "⏳ Waiting 10 seconds for server to start..."
sleep 10

echo ""
echo "🔍 Checking if server is running..."
pm2 status || ps aux | grep "node.*app.js" || docker-compose ps

echo ""
echo "📊 Server logs (last 20 lines):"
pm2 logs app.js --lines 20 || tail -20 app.log || docker-compose logs --tail 20

echo ""
echo "✅ Deployment completed!"

EOF

# Check if SSH was successful
if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Deployment commands executed successfully!"
    echo ""
    echo "🔍 Verifying deployment..."
    sleep 5
    
    # Test the deployed endpoints
    echo "📡 Testing /api/posts/all endpoint..."
    curl -s -o /dev/null -w "Status: %{http_code}\n" https://growsmartserver.gogrowsmart.com/api/posts/all || echo "❌ Failed to connect"
    
    echo "📡 Testing /api/teacherProfile endpoint..."
    curl -s -o /dev/null -w "Status: %{http_code}\n" -X POST https://growsmartserver.gogrowsmart.com/api/teacherProfile -H "Content-Type: application/json" -d '{}' || echo "❌ Failed to connect"
    
    echo ""
    echo "✅ Deployment verification completed!"
else
    echo "❌ SSH connection failed. Please check:"
    echo "   1. EC2 server is accessible"
    echo "   2. SSH keys are properly configured"
    echo "   3. User permissions are correct"
fi
