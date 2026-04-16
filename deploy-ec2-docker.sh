#!/bin/bash

# =============================================================================
# GROWSMART EC2 DOCKER PRODUCTION DEPLOYMENT
# With Redis, AstraDB, MongoDB, and WebSocket Support
# =============================================================================

set -e  # Exit on error

echo "=========================================="
echo "GrowSmart EC2 Docker Production Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check if we're in the right directory
if [ ! -f "app.js" ]; then
    print_status "ERROR" "Please run this script from the crowd-teach-gogrowsmart-backend directory"
    exit 1
fi

# =============================================================================
# STEP 1: Environment Setup
# =============================================================================
print_status "INFO" "Step 1: Environment Setup"

# Create necessary directories
mkdir -p uploads logs certs

# Set proper permissions
chmod -R 755 uploads logs

print_status "SUCCESS" "Directories created"

# =============================================================================
# STEP 2: Check Docker & Docker Compose
# =============================================================================
print_status "INFO" "Step 2: Checking Docker installation..."

if ! command -v docker &> /dev/null; then
    print_status "ERROR" "Docker not found. Installing Docker..."
    # Docker installation for Amazon Linux 2
    sudo yum update -y
    sudo amazon-linux-extras install docker -y
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    print_status "SUCCESS" "Docker installed"
fi

if ! command -v docker-compose &> /dev/null; then
    print_status "INFO" "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    print_status "SUCCESS" "Docker Compose installed"
fi

print_status "SUCCESS" "Docker environment ready"

# =============================================================================
# STEP 3: Stop Existing Containers
# =============================================================================
print_status "INFO" "Step 3: Stopping existing containers..."

docker-compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true

# Kill any existing node processes (fallback)
pkill -f "node app.js" 2>/dev/null || true

print_status "SUCCESS" "Existing containers stopped"

# =============================================================================
# STEP 4: Pull Latest Code (Optional - if using git)
# =============================================================================
if [ -d ".git" ]; then
    print_status "INFO" "Step 4: Pulling latest code from GitHub..."
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || print_status "WARNING" "Could not pull latest code"
    print_status "SUCCESS" "Code updated"
fi

# =============================================================================
# STEP 5: Build and Start Docker Containers
# =============================================================================
print_status "INFO" "Step 5: Building and starting Docker containers..."

# Build and start with production config
docker-compose -f docker-compose.production.yml build --no-cache

# Start services
docker-compose -f docker-compose.production.yml up -d

print_status "SUCCESS" "Containers started"

# =============================================================================
# STEP 6: Wait for Services to Initialize
# =============================================================================
print_status "INFO" "Step 6: Waiting for services to initialize..."

# Wait for Redis
print_status "INFO" "Checking Redis..."
for i in {1..30}; do
    if docker-compose -f docker-compose.production.yml exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
        print_status "SUCCESS" "Redis is ready"
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        print_status "ERROR" "Redis failed to start"
        exit 1
    fi
done

# Wait for backend to be ready
print_status "INFO" "Checking backend API..."
for i in {1..30}; do
    if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
        print_status "SUCCESS" "Backend API is ready"
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        print_status "ERROR" "Backend failed to start"
        docker-compose -f docker-compose.production.yml logs app --tail 50
        exit 1
    fi
done

# =============================================================================
# STEP 7: Health Checks
# =============================================================================
print_status "INFO" "Step 7: Running health checks..."

# Test API endpoints
ENDPOINTS=(
    "/api/ping"
    "/api/health"
)

for endpoint in "${ENDPOINTS[@]}"; do
    if curl -f "http://localhost:3000${endpoint}" > /dev/null 2>&1; then
        print_status "SUCCESS" "Endpoint ${endpoint} is working"
    else
        print_status "WARNING" "Endpoint ${endpoint} may have issues"
    fi
done

# =============================================================================
# STEP 8: Display Deployment Info
# =============================================================================
echo ""
echo "=========================================="
print_status "SUCCESS" "DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""

print_status "INFO" "Service Information:"
echo "  - Backend API: http://localhost:3000"
echo "  - WebSocket: ws://localhost:3000 (Socket.IO)"
echo "  - Redis: localhost:6379 (container internal)"
echo ""

print_status "INFO" "Docker Containers:"
docker-compose -f docker-compose.production.yml ps

echo ""
print_status "INFO" "Useful Commands:"
echo "  View logs:        docker-compose -f docker-compose.production.yml logs -f app"
echo "  View Redis logs:  docker-compose -f docker-compose.production.yml logs -f redis"
echo "  Restart:          docker-compose -f docker-compose.production.yml restart"
echo "  Stop:             docker-compose -f docker-compose.production.yml down"
echo "  Shell access:     docker-compose -f docker-compose.production.yml exec app sh"
echo ""

print_status "INFO" "WebSocket Configuration:"
echo "  - URL: wss://growsmartserver.gogrowsmart.com"
echo "  - Port: 3000 (same as HTTP API)"
echo "  - Transports: WebSocket + Polling"
echo "  - CORS enabled for: *.gogrowsmart.com"
echo ""

print_status "SUCCESS" "GrowSmart is now running in production! 🚀"
