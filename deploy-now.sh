#!/bin/bash

# EC2 DIRECT DEPLOYMENT SCRIPT
# Run this directly on your EC2 instance

echo "🚀 Starting GoGrowSmart Backend Deployment..."

# Navigate to home directory
cd /home/ec2-user

# Stop existing processes
echo "🛑 Stopping existing processes..."
pm2 stop all 2>/dev/null || true
pm2 delete all 2>/dev/null || true
pkill -f "node app.js" 2>/dev/null || true
lsof -ti:443 | xargs kill -9 2>/dev/null || true

# Backup current version
echo "💾 Backing up current version..."
if [ -d "crowd-teach-gogrowsmart-backend" ]; then
    cp -r crowd-teach-gogrowsmart-backend crowd-teach-gogrowsmart-backend-backup-$(date +%Y%m%d-%H%M%S)
    rm -rf crowd-teach-gogrowsmart-backend
fi

# Clone latest code
echo "📥 Cloning latest code from GitHub..."
git clone https://github.com/Scoder6/crowd-teach-gogrowsmart-backend.git
cd crowd-teach-gogrowsmart-backend

# Install dependencies
echo "📦 Installing dependencies..."
npm ci --production

# Ensure certs directory exists
echo "🔐 Setting up SSL certificates..."
mkdir -p /home/ec2-user/certs

# Generate self-signed certificate if not exists
if [ ! -f "/home/ec2-user/certs/privkey.pem" ] || [ ! -f "/home/ec2-user/certs/fullchain.pem" ]; then
    echo "⚠️  SSL certificates not found. Generating self-signed certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /home/ec2-user/certs/privkey.pem \
        -out /home/ec2-user/certs/fullchain.pem \
        -subj "/C=US/ST=State/L=City/O=GoGrowSmart/CN=growsmartserver.gogrowsmart.com"
    echo "✅ Self-signed certificates generated"
fi

# Set proper permissions
chmod 600 /home/ec2-user/certs/privkey.pem
chmod 644 /home/ec2-user/certs/fullchain.pem

# Test certificates
echo "🔍 Testing SSL certificates..."
if openssl x509 -in /home/ec2-user/certs/fullchain.pem -text -noout > /dev/null 2>&1; then
    echo "✅ SSL certificate is valid"
else
    echo "❌ SSL certificate is invalid"
    exit 1
fi

# Start the application
echo "🚀 Starting the application..."
pm2 start app.js --name backend

# Save PM2 configuration
pm2 save
pm2 startup

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 10

# Check if server is running
echo "🔍 Checking server status..."
pm2 status

# Test the server
echo "🧪 Testing server connectivity..."
if curl -k https://localhost:443/api/ping > /dev/null 2>&1; then
    echo "✅ Server is running locally"
else
    echo "❌ Server is not responding locally"
    pm2 logs backend --lines 20
    exit 1
fi

# Check external connectivity
echo "🌐 Testing external connectivity..."
if curl -k https://growsmartserver.gogrowsmart.com/api/ping > /dev/null 2>&1; then
    echo "✅ Server is accessible externally"
else
    echo "⚠️  Server may not be accessible externally. Check:"
    echo "   - EC2 Security Groups (ports 80, 443 open)"
    echo "   - Firewall settings"
fi

echo ""
echo "🎉 Deployment completed!"
echo "📊 Server Status:"
pm2 status
echo ""
echo "🌐 Your server should be accessible at:"
echo "   https://growsmartserver.gogrowsmart.com"
echo ""
echo "📋 Useful commands:"
echo "   View logs: pm2 logs backend"
echo "   Restart: pm2 restart backend"
echo "   Stop: pm2 stop backend"
