#!/bin/bash

# =============================================================================
# GROWSMART VPS DEPLOYMENT - MANUAL COMMANDS
# Run these commands one by one in your terminal
# =============================================================================

# VPS DETAILS
VPS_HOST="88.223.84.61"
VPS_USER="u385735845"
VPS_DIR="/home/u385735845/growsmart-backend"

echo "=========================================="
echo "VPS DEPLOYMENT COMMANDS"
echo "=========================================="
echo ""
echo "VPS: ${VPS_USER}@${VPS_HOST}"
echo "Directory: ${VPS_DIR}"
echo ""

# Step 1: Create tarball of backend
echo "STEP 1: Creating deployment package..."
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
tar -czf vps-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    .
echo "✅ Package created: vps-deploy.tar.gz"
echo ""

# Step 2: Upload to VPS via SCP
echo "STEP 2: Upload to VPS..."
echo "You'll be prompted for VPS password..."
scp vps-deploy.tar.gz ${VPS_USER}@${VPS_HOST}:~/
echo "✅ Uploaded!"
echo ""

# Step 3: SSH and deploy
echo "STEP 3: Deploying on VPS..."
echo "Run these commands on the VPS:"
echo ""
cat << 'SSHEOF'
# SSH into VPS
ssh u385735845@88.223.84.61

# Once logged in, run:
cd ~
tar -xzf vps-deploy.tar.gz
mkdir -p growsart-backend
cp -r * growsmart-backend/ 2>/dev/null || true
cd growsmart-backend

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    sudo systemctl start docker
    rm get-docker.sh
fi

# Install docker-compose if not present
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Stop existing containers
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker stop $(docker ps -q) 2>/dev/null || true

# Deploy
docker-compose -f docker-compose.production.yml up -d --build

# Wait and check
sleep 15
curl http://localhost:3000/api/ping

# View logs
docker-compose -f docker-compose.production.yml logs -f app
SSHEOF

echo ""
echo "=========================================="
echo "DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "Backend will be available at:"
echo "  API: http://88.223.84.61:3000"
echo "  WebSocket: ws://88.223.84.61:3000"
echo ""
