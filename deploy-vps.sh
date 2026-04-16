#!/bin/bash

# =============================================================================
# GROWSMART BACKEND - HOSTINGER VPS DEPLOYMENT
# Deploys backend + Redis + WebSocket to Hostinger VPS
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

# VPS Configuration
VPS_HOST="88.223.84.61"
VPS_USER="u385735845"
VPS_PASS="YourVPSPassword"  # Will prompt if not set
VPS_PORT="22"
REMOTE_DIR="/home/u385735845/growsmart-backend"

print_status "INFO" "=========================================="
print_status "INFO" "GROWSMART BACKEND - VPS DEPLOYMENT"
print_status "INFO" "=========================================="
print_status "INFO" "Target: ${VPS_USER}@${VPS_HOST}"
print_status "INFO" "Remote Directory: ${REMOTE_DIR}"
echo ""

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    print_status "INFO" "Installing sshpass..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install sshpass
    else
        sudo apt-get install -y sshpass
    fi
fi

# Get VPS password if not set
if [ -z "$VPS_PASS" ] || [ "$VPS_PASS" == "YourVPSPassword" ]; then
    echo -n "Enter VPS Password: "
    read -s VPS_PASS
    echo ""
fi

# Test connection
print_status "INFO" "Testing VPS connection..."
if ! sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${VPS_USER}@${VPS_HOST} "echo 'Connected to VPS'" 2>/dev/null; then
    print_status "ERROR" "Cannot connect to VPS. Check:"
    print_status "ERROR" "  - VPS IP: $VPS_HOST"
    print_status "ERROR" "  - Username: $VPS_USER"
    print_status "ERROR" "  - Password correct"
    print_status "ERROR" "  - Port 22 is open"
    exit 1
fi

print_status "SUCCESS" "VPS connection successful!"

# Create remote directory structure
print_status "INFO" "Setting up remote directory..."
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} << 'EOF'
    mkdir -p ~/growsmart-backend
    cd ~/growsmart-backend
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo "Installing Docker..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        sudo systemctl start docker
        sudo systemctl enable docker
        rm get-docker.sh
    fi
    
    # Check if docker-compose is installed
    if ! command -v docker-compose &> /dev/null; then
        echo "Installing Docker Compose..."
        sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi
    
    echo "Docker ready!"
EOF

print_status "SUCCESS" "VPS prepared!"

# Sync files to VPS
print_status "INFO" "Uploading backend files..."
sshpass -p "$VPS_PASS" rsync -avz --progress \
    -e "ssh -o StrictHostKeyChecking=no" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='ec2-deployment-package.tar.gz' \
    --exclude='backend-railway-ready.tar.gz' \
    ./ "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

print_status "SUCCESS" "Files uploaded!"

# Deploy on VPS
print_status "INFO" "Deploying on VPS..."
sshpass -p "$VPS_PASS" ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST} << DEPLOYEOF
    cd ${REMOTE_DIR}
    
    echo "=== Stopping existing containers ==="
    docker-compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true
    docker stop \$(docker ps -q) 2>/dev/null || true
    
    echo "=== Building and starting services ==="
    docker-compose -f docker-compose.production.yml build --no-cache
    docker-compose -f docker-compose.production.yml up -d
    
    echo "=== Waiting for services to start ==="
    sleep 20
    
    echo "=== Health check ==="
    for i in {1..10}; do
        if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
            echo "✅ Backend is healthy!"
            break
        fi
        echo "Attempt \$i/10..."
        sleep 5
    done
    
    echo "=== Container status ==="
    docker-compose -f docker-compose.production.yml ps
    
    echo "=== Testing Redis ==="
    docker-compose -f docker-compose.production.yml exec -T redis redis-cli ping 2>/dev/null || echo "Redis check skipped"
    
    echo ""
    echo "🎉 DEPLOYMENT COMPLETE!"
    echo "   Backend running on: http://${VPS_HOST}:3000"
    echo "   WebSocket ready on: ws://${VPS_HOST}:3000"
DEPLOYEOF

print_status "SUCCESS" "=========================================="
print_status "SUCCESS" "BACKEND DEPLOYED TO VPS!"
print_status "SUCCESS" "=========================================="
echo ""
print_status "INFO" "API URL: http://${VPS_HOST}:3000"
print_status "INFO" "WebSocket: ws://${VPS_HOST}:3000"
print_status "INFO" "Test API: curl http://${VPS_HOST}:3000/api/ping"
echo ""
print_status "INFO" "View logs:"
echo "  ssh ${VPS_USER}@${VPS_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.production.yml logs -f app'"
echo ""
print_status "INFO" "Restart:"
echo "  ssh ${VPS_USER}@${VPS_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.production.yml restart'"
echo ""
