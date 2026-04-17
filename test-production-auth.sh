#!/bin/bash

# Production Authentication Test Script for Hostinger API
# This script tests the complete authentication flow against production

# Configuration
PRODUCTION_API_URL="https://growsmartserver.gogrowsmart.com"
TEST_USERS=(
    "student1@example.com"
    "teacher31@example.com"
    "teacher56@example.com"
)

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

echo "======================================"
echo "🧪 PRODUCTION AUTHENTICATION TEST SUITE"
echo "======================================"
echo "📍 API URL: $PRODUCTION_API_URL"
echo "📍 Testing users: ${TEST_USERS[@]}"
echo ""

# Function to send OTP
test_send_otp() {
    local email=$1
    echo -e "${BLUE}📧 Test: Sending OTP to $email${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        otp_id=$(echo "$body" | grep -o '"otpId":"[^"]*' | cut -d'"' -f4)
        role=$(echo "$body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
        message=$(echo "$body" | grep -o '"message":"[^"]*' | cut -d'"' -f4)
        
        echo -e "${GREEN}✅ OTP sent successfully${NC}"
        echo "   - OTP ID: $otp_id"
        echo "   - Role: $role"
        echo "   - Message: $message"
        
        ((PASSED++))
        echo "$otp_id"
        return 0
    else
        echo -e "${RED}❌ Failed to send OTP (HTTP $http_code)${NC}"
        echo "   - Response: $body"
        ((FAILED++))
        return 1
    fi
}

# Function to verify OTP
test_verify_otp() {
    local email=$1
    local otp=$2
    local otp_id=$3
    
    echo -e "${BLUE}🔐 Test: Verifying OTP for $email${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/verify-otp" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\", \"otp\": \"$otp\", \"otpId\": \"$otp_id\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        token=$(echo "$body" | grep -o '"token":"[^"]*' | cut -d'"' -f4 | head -c 50)
        role=$(echo "$body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
        
        echo -e "${GREEN}✅ OTP verified successfully${NC}"
        echo "   - Token: ${token}..."
        echo "   - Role: $role"
        
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ Failed to verify OTP (HTTP $http_code)${NC}"
        echo "   - Response: $body"
        ((FAILED++))
        return 1
    fi
}

# Function to refresh token
test_refresh_token() {
    local email=$1
    
    echo -e "${BLUE}🔄 Test: Refreshing token for $email${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/refresh-token" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        token=$(echo "$body" | grep -o '"token":"[^"]*' | cut -d'"' -f4 | head -c 50)
        role=$(echo "$body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
        name=$(echo "$body" | grep -o '"name":"[^"]*' | cut -d'"' -f4)
        
        echo -e "${GREEN}✅ Token refreshed successfully${NC}"
        echo "   - New Token: ${token}..."
        echo "   - Role: $role"
        echo "   - Name: $name"
        
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ Failed to refresh token (HTTP $http_code)${NC}"
        echo "   - Response: $body"
        ((FAILED++))
        return 1
    fi
}

# Function to test invalid OTP
test_invalid_otp() {
    local email=$1
    
    echo -e "${BLUE}❌ Test: Testing invalid OTP for $email${NC}"
    
    # First get a valid OTP ID
    otp_id=$(test_send_otp "$email")
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # Try to verify with wrong OTP
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/verify-otp" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\", \"otp\": \"0000\", \"otpId\": \"$otp_id\"}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "400" ]; then
        echo -e "${GREEN}✅ Invalid OTP correctly rejected${NC}"
        echo "   - Error message: $body"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ Invalid OTP was not rejected (HTTP $http_code)${NC}"
        ((FAILED++))
        return 1
    fi
}

# Main test loop
for user in "${TEST_USERS[@]}"; do
    echo ""
    echo "======================================"
    echo "👤 Testing User: $user"
    echo "======================================"
    
    # Test 1: Send OTP
    otp_id=$(test_send_otp "$user")
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠️  Skipping remaining tests for $user${NC}"
        continue
    fi
    
    # Note: We can't automatically verify OTP in production without access to the database
    # So we'll just test that the OTP was sent and refresh token works
    
    # Test 2: Refresh token
    test_refresh_token "$user"
    
    # Only run invalid OTP test for first user to save time
    if [ "$user" = "${TEST_USERS[0]}" ]; then
        test_invalid_otp "$user"
    fi
done

# Print summary
echo ""
echo "======================================"
echo "📊 TEST SUMMARY"
echo "======================================"
echo "Total Tests: $((PASSED + FAILED))"
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo "======================================"

if [ $FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi
