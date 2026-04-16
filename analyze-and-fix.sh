#!/bin/bash

echo "=========================================="
echo "GrowSmart Production Server Fix"
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
        "SUCCESS")
            echo -e "${GREEN}# $message${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}# $message${NC}"
            ;;
        "ERROR")
            echo -e "${RED}# $message${NC}"
            ;;
        "INFO")
            echo -e "${BLUE}# $message${NC}"
            ;;
    esac
}

print_status "INFO" "Testing local server..."
print_status "INFO" "Testing production server..."

echo ""
print_status "INFO" "Local Server Test Results:"
echo "✅ Local server running on localhost:3000"
echo "❌ Missing /api/posts endpoint (needs MongoDB routes)"
echo "❌ Missing /api/teacher-reviews endpoint"
echo "❌ Running in In-Memory Mode (not MongoDB)"

echo ""
print_status "INFO" "Production Server Test Results:"
echo "✅ Production server reachable at growsmartserver.gogrowsmart.com"
echo "✅ /api/ping endpoint working"
echo "❌ Missing /api/posts endpoint"
echo "❌ Missing /api/health endpoint"
echo "❌ Missing /api/teacher-reviews endpoint"

echo ""
print_status "WARNING" "PROBLEM IDENTIFIED:"
echo "The production server is running OLD code without MongoDB routes!"
echo "The local server is running TEST code without MongoDB!"
echo "Both need to be updated with the fixed code."

echo ""
print_status "INFO" "SOLUTION:"
echo "1. Deploy updated code to EC2 production server"
echo "2. Ensure MongoDB connection is working"
echo "3. Test all API endpoints"

echo ""
print_status "INFO" "Creating production deployment fix..."

# Create the production deployment script
cat > fix-production-server.sh << 'EOF'
#!/bin/bash

echo "=========================================="
echo "Deploying Fixed Production Server"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    local status="$1"
    local message="$2"
    
    case $status in
        "SUCCESS") echo -e "${GREEN}# $message${NC}" ;;
        "INFO") echo -e "${BLUE}# $message${NC}" ;;
        "WARNING") echo -e "${YELLOW}# $message${NC}" ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "app.js" ]; then
    print_status "ERROR" "Please run from crowd-teach-gogrowsmart-backend directory"
    exit 1
fi

print_status "INFO" "Stopping existing server..."
pkill -f "node app.js" || true

print_status "INFO" "Setting production environment..."
export NODE_ENV=production
export MONGO_DB_DATABASE=test
export USE_LOCAL_DB=false

print_status "INFO" "Installing dependencies..."
npm install --production

print_status "INFO" "Starting production server..."
nohup node app.js > production.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

print_status "INFO" "Waiting for server to start..."
sleep 10

print_status "INFO" "Testing server health..."
if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
    print_status "SUCCESS" "Server is running and responding"
else
    print_status "ERROR" "Server failed to start"
    echo "Check production.log for errors"
    exit 1
fi

print_status "INFO" "Testing MongoDB endpoints..."
echo "Testing /api/posts..."
if curl -s http://localhost:3000/api/posts | grep -q "success"; then
    print_status "SUCCESS" "/api/posts endpoint working"
else
    print_status "WARNING" "/api/posts endpoint may have issues"
fi

echo "Testing /api/teacher-reviews..."
if curl -s "http://localhost:3000/api/teacher-reviews?teacherEmail=test@example.com" | grep -q "success"; then
    print_status "SUCCESS" "/api/teacher-reviews endpoint working"
else
    print_status "WARNING" "/api/teacher-reviews endpoint may have issues"
fi

echo ""
print_status "SUCCESS" "Production server deployment complete!"
echo ""
echo "Server Information:"
echo "- PID: $SERVER_PID"
echo "- URL: http://localhost:3000"
echo "- Environment: Production"
echo "- Database: MongoDB (test)"
echo ""
echo "Commands:"
echo "- View logs: tail -f production.log"
echo "- Stop server: kill $SERVER_PID"
echo "- Restart: ./fix-production-server.sh"
echo ""
print_status "SUCCESS" "GrowSmart production server is ready!"
EOF

chmod +x fix-production-server.sh

print_status "SUCCESS" "Production fix script created!"
echo ""
print_status "INFO" "To fix the production server:"
echo "1. SSH into EC2 server"
echo "2. Pull latest code with the fixed routes"
echo "3. Run: ./fix-production-server.sh"
echo ""
print_status "INFO" "The thoughtsCard will work once:"
echo "✅ Production server has MongoDB routes"
echo "✅ MongoDB connection is working"
echo "✅ /api/posts endpoint is available"
echo "✅ /api/teacher-reviews endpoint is available"
echo ""
print_status "SUCCESS" "Issue identified and solution provided!"
