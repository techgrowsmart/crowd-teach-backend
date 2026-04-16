#!/bin/bash

# =============================================================================
# EC2 DEPLOYMENT VERIFICATION SCRIPT
# Run this after deployment to verify all services are working
# =============================================================================

EC2_IP="3.95.195.41"
EC2_HOST="ec2-3-95-195-41.compute-1.amazonaws.com"
KEY_FILE="./growsmart-key.pem"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${YELLOW}==========================================${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}==========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header "EC2 DEPLOYMENT VERIFICATION"

# Test 1: API Ping
print_header "TEST 1: API Ping Test"
RESPONSE=$(curl -s -w "\n%{http_code}" http://${EC2_IP}:3000/api/ping 2>/dev/null || echo "FAILED")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    print_success "API is responding (HTTP 200)"
    echo "Response: $BODY"
else
    print_error "API not responding (HTTP: $HTTP_CODE)"
fi

# Test 2: Health Check
print_header "TEST 2: Health Check"
RESPONSE=$(curl -s -w "\n%{http_code}" http://${EC2_IP}:3000/health 2>/dev/null || echo "FAILED")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
    print_success "Health check passed (HTTP 200)"
else
    print_error "Health check failed (HTTP: $HTTP_CODE)"
fi

# Test 3: Root Endpoint
print_header "TEST 3: Root Endpoint"
RESPONSE=$(curl -s -w "\n%{http_code}" http://${EC2_IP}:3000/ 2>/dev/null || echo "FAILED")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
    print_success "Root endpoint responding"
else
    print_error "Root endpoint not responding (HTTP: $HTTP_CODE)"
fi

# Test 4: SSH and Docker Container Check
print_header "TEST 4: Docker Containers"
ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no "ec2-user@${EC2_HOST}" << 'EOF'
    echo "Container Status:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.State}}"
    echo ""
    
    echo "Redis Test:"
    docker exec growsmart-redis redis-cli ping 2>/dev/null || echo "Redis check failed"
    echo ""
    
    echo "MongoDB Test:"
    docker exec growsmart-mongodb mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null | grep -q "ok" && echo "✅ MongoDB responding" || echo "❌ MongoDB check failed"
EOF

print_header "VERIFICATION COMPLETE"
echo ""
echo "Your backend should be accessible at:"
echo "  - API:      http://3.95.195.41:3000"
echo "  - WebSocket: ws://3.95.195.41:3000"
echo ""
