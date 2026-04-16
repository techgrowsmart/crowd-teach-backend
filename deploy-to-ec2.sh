#!/bin/bash

# =============================================================================
# GROWSMART EC2 DEPLOYMENT HELPER
# This script helps deploy to EC2 with proper error handling
# =============================================================================

set -e  # Exit on error

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    local status="$1"
    local message="$2"
    case $status in
        "SUCCESS") echo -e "${GREEN}✅ $message${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "ERROR") echo -e "${RED}❌ $message${NC}" ;;
        "INFO") echo -e "${BLUE}ℹ️  $message${NC}" ;;
    esac
}

EC2_HOST="growsmartserver.gogrowsmart.com"
EC2_USER="ec2-user"
KEY_FILE=""

# Find the correct key file
if [ -f "./gogrowsmart-key.pem" ]; then
    KEY_FILE="./gogrowsmart-key.pem"
elif [ -f "./growsmart-key.pem" ]; then
    KEY_FILE="./growsmart-key.pem"
else
    print_status "ERROR" "No SSH key file found (looking for gogrowsmart-key.pem or growsmart-key.pem)"
    exit 1
fi

print_status "INFO" "Using key file: $KEY_FILE"

# Ensure key has correct permissions
if [ "$(stat -c %a "$KEY_FILE" 2>/dev/null || stat -f %Lp "$KEY_FILE")" != "600" ]; then
    print_status "WARNING" "Key file permissions need fixing..."
    chmod 600 "$KEY_FILE"
    print_status "SUCCESS" "Key permissions fixed (600)"
fi

# Test SSH connection first
print_status "INFO" "Testing SSH connection to $EC2_USER@$EC2_HOST..."
if ! ssh -i "$KEY_FILE" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_USER@$EC2_HOST" "echo 'SSH connection successful'" 2>/dev/null; then
    # Try with ubuntu user
    EC2_USER="ubuntu"
    print_status "INFO" "Trying with ubuntu user..."
    if ! ssh -i "$KEY_FILE" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_USER@$EC2_HOST" "echo 'SSH connection successful'" 2>/dev/null; then
        print_status "ERROR" "Cannot connect to EC2. Check:"
        print_status "ERROR" "  1. EC2 instance is running"
        print_status "ERROR" "  2. Security group allows SSH (port 22)"
        print_status "ERROR" "  3. Key file is correct"
        exit 1
    fi
fi

print_status "SUCCESS" "SSH connection working with user: $EC2_USER"

# Sync files to EC2
print_status "INFO" "Syncing files to EC2..."
rsync -avz --progress \
    -e "ssh -i $KEY_FILE" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    ./ "$EC2_USER@$EC2_HOST:~/crowd-teach-gogrowsmart-backend/"

print_status "SUCCESS" "Files synced to EC2"

# Execute deployment on EC2
print_status "INFO" "Executing deployment on EC2..."
ssh -i "$KEY_FILE" "$EC2_USER@$EC2_HOST" << 'EOF'
    cd ~/crowd-teach-gogrowsmart-backend
    
    # Stop existing containers
    docker-compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true
    
    # Ensure .env.production exists
    if [ ! -f ".env.production" ]; then
        echo "⚠️  Warning: .env.production not found, using .env"
        cp .env .env.production 2>/dev/null || true
    fi
    
    # Build and start
    docker-compose -f docker-compose.production.yml build --no-cache
    docker-compose -f docker-compose.production.yml up -d
    
    # Wait for services
    echo "⏳ Waiting for services to start..."
    sleep 15
    
    # Health check
    for i in {1..10}; do
        if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
            echo "✅ Backend is healthy!"
            break
        fi
        echo "⏳ Attempt $i/10..."
        sleep 5
    done
    
    # Show status
    echo ""
    echo "📊 Container Status:"
    docker-compose -f docker-compose.production.yml ps
    
    echo ""
    echo "🌐 Deployment Complete!"
    echo "   API: http://localhost:3000"
    echo "   Run 'docker-compose -f docker-compose.production.yml logs -f app' to view logs"
EOF

print_status "SUCCESS" "Deployment complete!"
