#!/bin/bash
# Hostinger Backend Deploy - Subscription Fix

VPS_IP="88.223.84.61"
VPS_PORT="65002"
VPS_USER="u385735845"
LOCAL_BACKEND="/Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend"

echo "🚀 Deploying to Hostinger VPS..."
echo "IP: $VPS_IP:$VPS_PORT"
echo ""

# Create deployment package
echo "📦 Creating deployment package..."
cd "$LOCAL_BACKEND"
tar -czf hostinger-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    --exclude='.env' \
    .

echo "✅ Package created"
echo ""

# Get VPS password from user
echo "🔑 You'll need your VPS password from Hostinger panel"
echo "   (Found in Advanced → SSH Access)"
echo ""

# Upload via SCP on port 65002
echo "📤 Uploading to VPS..."
echo "   Command: scp -P $VPS_PORT hostinger-deploy.tar.gz $VPS_USER@$VPS_IP:~/"
echo ""
scp -P $VPS_PORT hostinger-deploy.tar.gz $VPS_USER@$VPS_IP:~/

echo ""
echo "📋 Next steps - SSH into VPS and deploy:"
echo "=========================================="
echo ""
echo "1. SSH into your VPS:"
echo "   ssh -p $VPS_PORT $VPS_USER@$VPS_IP"
echo ""
echo "2. Once logged in, run these commands:"
cat << 'SSHEOF'

# Extract the package
cd ~
tar -xzf hostinger-deploy.tar.gz
mkdir -p backend
cp -r * backend/ 2>/dev/null || true
cd backend

# Create .env file (you'll need to add your secrets)
cat > .env << 'ENVEOF'
PORT=3000
RAZORPAY_KEY_ID=your_key_here
RAZORPAY_KEY_SECRET=your_secret_here
ASTRA_DB_USERNAME=your_username
ASTRA_DB_PASSWORD=your_password
ASTRA_DB_KEYSPACE=your_keyspace
ASTRA_TOKEN=your_token
JWT_SECRET=your_jwt_secret
ENVEOF

# Install dependencies
npm install

# Start the backend
npm start

# Or use PM2 for production:
# npm install -g pm2
# pm2 start app.js --name backend
# pm2 save
# pm2 startup

SSHEOF

echo ""
echo "=========================================="
echo "🌐 Backend will be available at:"
echo "   http://$VPS_IP:3000"
echo ""
echo "⚠️  IMPORTANT: Enable SSH in Hostinger first!"
echo "   Go to: Advanced → SSH Access → Click 'Enable'"
echo ""
echo "🔒 SECURITY: Add these environment variables to your .env file:"
echo "   - RAZORPAY_KEY_ID"
echo "   - RAZORPAY_KEY_SECRET"
echo "   - ASTRA_DB credentials"
echo "   - JWT_SECRET"
