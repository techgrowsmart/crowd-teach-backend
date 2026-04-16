#!/bin/bash

# =============================================================================
# GROWSMART BACKEND - HOSTINGER VPS DEPLOYMENT (FIXED)
# Tries multiple SSH ports and provides fallback options
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    case $1 in
        "SUCCESS") echo -e "${GREEN}✅ $2${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  $2${NC}" ;;
        "ERROR") echo -e "${RED}❌ $2${NC}" ;;
        "INFO") echo -e "${BLUE}ℹ️  $2${NC}" ;;
    esac
}

# VPS Configuration - MODIFY THESE IF NEEDED
VPS_IP="88.223.84.61"
VPS_USER="u385735845"
SSH_PORT="22"  # Will try 65002 if this fails

echo ""
print_status "INFO" "=========================================="
print_status "INFO" "GROWSMART BACKEND - VPS DEPLOYMENT"
print_status "INFO" "=========================================="
echo ""

# Ask for password
if [ -z "$VPS_PASS" ]; then
    echo -n "Enter VPS Password: "
    read -s VPS_PASS
    echo ""
fi

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    print_status "INFO" "Installing sshpass..."
    brew install sshpass 2>/dev/null || sudo apt-get install -y sshpass 2>/dev/null || echo "Please install sshpass manually"
fi

# Try SSH on different ports
print_status "INFO" "Testing SSH connection..."

# Try port 22 first
if sshpass -p "$VPS_PASS" ssh -p 22 -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${VPS_USER}@${VPS_IP} "echo 'OK'" >/dev/null 2>&1; then
    SSH_PORT=22
    print_status "SUCCESS" "SSH connected on port 22!"
# Try port 65002 (common Hostinger VPS port)
elif sshpass -p "$VPS_PASS" ssh -p 65002 -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${VPS_USER}@${VPS_IP} "echo 'OK'" >/dev/null 2>&1; then
    SSH_PORT=65002
    print_status "SUCCESS" "SSH connected on port 65002!"
else
    echo ""
    print_status "ERROR" "Cannot connect via SSH on ports 22 or 65002"
    echo ""
    print_status "WARNING" "You may have:"
    echo "  • Hostinger SHARED HOSTING (no SSH access)"
    echo "  • Different SSH port (check Hostinger panel)"
    echo "  • SSH not enabled on your VPS"
    echo ""
    print_status "INFO" "ALTERNATIVES:"
    echo ""
    echo "1️⃣  RAILWAY (Recommended - 5 min setup):"
    echo "   → Go to: https://railway.app"
    echo "   → Upload: backend-railway-ready.tar.gz (2.4MB)"
    echo "   → Add env vars from .env.production"
    echo "   → See: DEPLOY-RAILWAY.md for full guide"
    echo ""
    echo "2️⃣  RENDER (Alternative):"
    echo "   → Go to: https://render.com"
    echo "   → Same process as Railway"
    echo "   → See: DEPLOY-RENDER.md for guide"
    echo ""
    echo "3️⃣  Enable SSH on Hostinger VPS:"
    echo "   → Login to Hostinger control panel"
    echo "   → Go to VPS → Manage → SSH Access"
    echo "   → Enable SSH and note the port"
    echo "   → Then re-run this script"
    echo ""
    
    echo -n "Would you like to deploy to Railway instead? (y/n): "
    read answer
    if [[ $answer =~ ^[Yy]$ ]]; then
        print_status "INFO" "Opening Railway deployment guide..."
        cat DEPLOY-RAILWAY.md
    fi
    exit 1
fi

# Deploy using the working port
print_status "INFO" "Deploying via SSH on port ${SSH_PORT}..."

# Create tarball
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
print_status "INFO" "Creating deployment package..."
tar -czf vps-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    . 2>/dev/null
print_status "SUCCESS" "Package created: vps-deploy.tar.gz"

# Upload and deploy
print_status "INFO" "Uploading to VPS..."
sshpass -p "$VPS_PASS" scp -P ${SSH_PORT} -o StrictHostKeyChecking=no \
    vps-deploy.tar.gz ${VPS_USER}@${VPS_IP}:~/

print_status "SUCCESS" "Uploaded!"

print_status "INFO" "Deploying on VPS..."
sshpass -p "$VPS_PASS" ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_IP} << DEPLOYEOF
    cd ~
    tar -xzf vps-deploy.tar.gz
    mkdir -p growsmart-backend
    cp -r * growsmart-backend/ 2>/dev/null || true
    cd growsmart-backend
    
    # Install Docker if needed
    if ! command -v docker &> /dev/null; then
        echo "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker \$USER
        sudo systemctl start docker 2>/dev/null || sudo service docker start
        rm get-docker.sh
    fi
    
    # Install docker-compose if needed
    if ! command -v docker-compose &> /dev/null; then
        sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi
    
    # Stop existing containers
    docker-compose -f docker-compose.production.yml down 2>/dev/null || true
    docker stop \$(docker ps -q) 2>/dev/null || true
    
    # Deploy
    echo "Building and starting containers..."
    docker-compose -f docker-compose.production.yml up -d --build
    
    # Wait and test
    sleep 15
    echo "Testing deployment..."
    curl -s http://localhost:3000/api/ping && echo " - API OK" || echo " - API not ready yet"
    
    echo ""
    echo "🎉 DEPLOYMENT COMPLETE!"
    echo "   API: http://${VPS_IP}:3000"
    echo "   WebSocket: ws://${VPS_IP}:3000"
DEPLOYEOF

print_status "SUCCESS" "=========================================="
print_status "SUCCESS" "BACKEND DEPLOYED!"
print_status "SUCCESS" "=========================================="
echo ""
print_status "INFO" "API URL: http://${VPS_IP}:3000"
print_status "INFO" "WebSocket: ws://${VPS_IP}:3000"
print_status "INFO" "Test: curl http://${VPS_IP}:3000/api/ping"
echo ""
print_status "INFO" "View logs:"
echo "  ssh -p ${SSH_PORT} ${VPS_USER}@${VPS_IP} 'cd ~/growsmart-backend && docker-compose -f docker-compose.production.yml logs -f app'"
