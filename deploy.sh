#!/bin/bash
# Deploy script for VPS - crowd-teach-gogrowsmart-backend

VPS_IP="88.223.84.61"
VPS_PORT="65002"
VPS_USER="u385735845"
LOCAL_DIR="/Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend"
REMOTE_DIR="api.gogrowsmart.com"

echo "=========================================="
echo "Deploying Backend to VPS"
echo "=========================================="
echo "VPS: $VPS_USER@$VPS_IP:$VPS_PORT"
echo ""

# Step 1: Create deployment package
echo "📦 Creating deployment package..."
cd "$LOCAL_DIR"
tar -czf backend-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    --exclude='.env' \
    --exclude='tests' \
    --exclude='scripts' \
    --exclude='exports' \
    --exclude='logs' \
    --exclude='*.md' \
    --exclude='*.sh' \
    --exclude='android-signing-backup' \
    --exclude='certs' \
    --exclude='bin' \
    .env.production \
    package.json \
    package-lock.json \
    app.js \
    socket.js \
    secure-connect-gogrowsmart.zip \
    config/ \
    routes/ \
    middleware/ \
    models/ \
    utils/ \
    services/ \
    controllers/ \
    views/

echo "✅ Package created: backend-deploy.tar.gz"
echo ""

# Step 2: Upload to VPS
echo "📤 Uploading to VPS..."
scp -P $VPS_PORT backend-deploy.tar.gz $VPS_USER@$VPS_IP:~/

echo "✅ Upload complete"
echo ""

# Step 3: SSH and deploy
echo "🔧 Setting up on VPS..."
ssh -p $VPS_PORT $VPS_USER@$VPS_IP << 'REMOTE_EOF'

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Setup app directory
mkdir -p ~/api.gogrowsmart.com
cd ~/api.gogrowsmart.com

# Extract files
tar -xzf ~/backend-deploy.tar.gz -C .

# Rename env file
mv .env.production .env 2>/dev/null || true

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Start/restart with PM2
pm2 describe api-backend > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Restarting backend..."
    pm2 restart api-backend --update-env
else
    echo "Starting backend..."
    pm2 start app.js --name api-backend
fi

# Save PM2 config
pm2 save

# Setup startup
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo ""
echo "=========================================="
echo "✅ DEPLOYMENT COMPLETE!"
echo "=========================================="
echo "API URL: http://88.223.84.61:3000"
echo "Health:  http://88.223.84.61:3000/health"
echo ""
pm2 status

REMOTE_EOF

# Cleanup
cd "$LOCAL_DIR"
rm -f backend-deploy.tar.gz

echo ""
echo "🎉 Deploy finished! Test your API:"
echo "   curl http://88.223.84.61:3000/health"
