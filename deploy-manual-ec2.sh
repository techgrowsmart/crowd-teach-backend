#!/bin/bash

# =============================================================================
# MANUAL EC2 DEPLOYMENT - Run this ON THE EC2 SERVER
# =============================================================================

set -e

echo "=========================================="
echo "GROWSMART BACKEND - MANUAL DEPLOYMENT"
echo "=========================================="
echo ""

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

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_status "INFO" "Docker not found. Installing..."
    
    # Detect OS and install Docker
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        
        if [[ "$ID" == "amzn" ]] || [[ "$ID" == "amazon" ]]; then
            # Amazon Linux 2
            sudo yum update -y
            sudo amazon-linux-extras install docker -y
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
            
        elif [[ "$ID" == "ubuntu" ]] || [[ "$ID" == "debian" ]]; then
            # Ubuntu/Debian
            sudo apt-get update
            sudo apt-get install -y docker.io docker-compose
            sudo systemctl start docker
            sudo systemctl enable docker
            sudo usermod -aG docker $USER
        fi
    fi
    
    print_status "SUCCESS" "Docker installed. Please logout and login again, then re-run this script."
    exit 0
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_status "INFO" "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    print_status "SUCCESS" "Docker Compose installed"
fi

print_status "SUCCESS" "Docker environment ready"

# Create necessary directories
mkdir -p uploads logs certs

# Set permissions
chmod -R 755 uploads logs

# Stop existing containers
print_status "INFO" "Stopping existing containers..."
docker-compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true
pkill -f "node app.js" 2>/dev/null || true

# Build and start
print_status "INFO" "Building and starting containers..."
docker-compose -f docker-compose.production.yml build --no-cache
docker-compose -f docker-compose.production.yml up -d

# Wait for services
print_status "INFO" "Waiting for services to start..."
sleep 15

# Health check
print_status "INFO" "Running health checks..."
for i in {1..10}; do
    if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
        print_status "SUCCESS" "Backend is healthy!"
        break
    fi
    echo "  Attempt $i/10..."
    sleep 5
    
    if [ $i -eq 10 ]; then
        print_status "ERROR" "Backend failed to start. Check logs:"
        echo "  docker-compose -f docker-compose.production.yml logs app"
    fi
done

# Check Redis
docker-compose -f docker-compose.production.yml exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG" && print_status "SUCCESS" "Redis is ready"

# Show status
echo ""
print_status "SUCCESS" "DEPLOYMENT COMPLETE!"
echo ""
print_status "INFO" "Container Status:"
docker-compose -f docker-compose.production.yml ps

echo ""
print_status "INFO" "Useful Commands:"
echo "  View logs:    docker-compose -f docker-compose.production.yml logs -f app"
echo "  View Redis:   docker-compose -f docker-compose.production.yml logs -f redis"
echo "  Restart:      docker-compose -f docker-compose.production.yml restart"
echo "  Stop:         docker-compose -f docker-compose.production.yml down"
echo "  Test API:     curl http://localhost:3000/api/ping"
echo ""
print_status "SUCCESS" "Server is running on port 3000!"
