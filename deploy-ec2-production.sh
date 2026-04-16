#!/bin/bash

echo "=========================================="
echo "GrowSmart EC2 Production Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    local status="\$1"
    local message="\$2"
    
    case \$status in
        "SUCCESS") echo -e "\${GREEN}# \$message\${NC}" ;;
        "WARNING") echo -e "\${YELLOW}# \$message\${NC}" ;;
        "ERROR") echo -e "\${RED}# \$message\${NC}" ;;
        "INFO") echo -e "\${BLUE}# \$message\${NC}" ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "app.js" ]; then
    print_status "ERROR" "Please run this script from the crowd-teach-gogrowsmart-backend directory"
    exit 1
fi

print_status "INFO" "Starting EC2 production deployment..."

# 1. Install dependencies
print_status "INFO" "Installing dependencies..."
npm install --production

# 2. Set production environment
print_status "INFO" "Setting production environment..."
export NODE_ENV=production
export MONGO_DB_DATABASE=test

# 3. Stop existing process
print_status "INFO" "Stopping existing server..."
pkill -f "node app.js" || true

# 4. Start production server
print_status "INFO" "Starting production server..."
nohup node app.js > production.log 2>&1 &
SERVER_PID=\$!
echo "Server PID: \$SERVER_PID"

# 5. Wait for server to start
print_status "INFO" "Waiting for server to start..."
sleep 10

# 6. Test server health
print_status "INFO" "Testing server health..."
if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
    print_status "SUCCESS" "Server is running and responding"
else
    print_status "ERROR" "Server failed to start"
    echo "Check production.log for errors"
    exit 1
fi

# 7. Test MongoDB connection
print_status "INFO" "Testing MongoDB connection..."
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    print_status "SUCCESS" "MongoDB connection working"
else
    print_status "WARNING" "MongoDB connection may have issues"
fi

# 8. Test new API endpoints
print_status "INFO" "Testing new API endpoints..."

# Test teacher reviews endpoint
if curl -f "http://localhost:3000/api/teacher-reviews?teacherEmail=test@example.com" > /dev/null 2>&1; then
    print_status "SUCCESS" "Teacher reviews endpoint working"
else
    print_status "WARNING" "Teacher reviews endpoint may have issues"
fi

# Test contacts endpoint
if curl -f http://localhost:3000/api/contacts -H "Authorization: Bearer test-token" > /dev/null 2>&1; then
    print_status "SUCCESS" "Contacts endpoint working"
else
    print_status "WARNING" "Contacts endpoint may have issues"
fi

# Test enrollment data endpoint
if curl -f http://localhost:3000/api/enrollment-data -H "Authorization: Bearer test-token" > /dev/null 2>&1; then
    print_status "SUCCESS" "Enrollment data endpoint working"
else
    print_status "WARNING" "Enrollment data endpoint may have issues"
fi

echo ""
print_status "SUCCESS" "EC2 Production Deployment Complete!"
echo ""
echo -e "\${GREEN}Server Information:\${NC}"
echo "PID: \$SERVER_PID"
echo "URL: http://localhost:3000"
echo "Environment: Production"
echo "Database: MongoDB (test)"
echo ""
echo -e "\${BLUE}New API Endpoints:\${NC}"
echo "GET  /api/teacher-reviews"
echo "GET  /api/reviews/teacher"
echo "POST /api/teacher-reviews"
echo "GET  /api/contacts"
echo "POST /api/contacts"
echo "GET  /api/enrollment-data"
echo "POST /api/enrollment-data"
echo ""
echo -e "\${YELLOW}Commands:\${NC}"
echo "View logs: tail -f production.log"
echo "Stop server: kill \$SERVER_PID"
echo "Restart: ./deploy-ec2-production.sh"
echo ""
print_status "SUCCESS" "GrowSmart server is ready for production!"
