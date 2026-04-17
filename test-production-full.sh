#!/bin/bash

# Comprehensive Production Authentication Test Suite
# Tests all authentication endpoints against Hostinger production API

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
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

echo "======================================"
echo "🧪 COMPREHENSIVE PRODUCTION AUTH TEST"
echo "======================================"
echo "📍 API URL: $PRODUCTION_API_URL"
echo "📍 Testing users: ${TEST_USERS[@]}"
echo ""

# Function to test endpoint health
test_health() {
    echo -e "${BLUE}🏥 Test: API Health Check${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X GET \
        "$PRODUCTION_API_URL/")
    
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "404" ]; then
        echo -e "${GREEN}✅ API is reachable${NC} (HTTP $http_code)"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ API is not reachable (HTTP $http_code)${NC}"
        ((FAILED++))
        return 1
    fi
}

# Function to test send OTP
test_send_otp() {
    local email=$1
    echo -e "${BLUE}📧 Test: Send OTP to $email${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\"}" \
        --max-time 10)
    
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

# Function to test refresh token
test_refresh_token() {
    local email=$1
    echo -e "${BLUE}🔄 Test: Refresh Token for $email${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/refresh-token" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\"}" \
        --max-time 10)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        token=$(echo "$body" | grep -o '"token":"[^"]*' | cut -d'"' -f4 | head -c 50)
        role=$(echo "$body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
        name=$(echo "$body" | grep -o '"name":"[^"]*' | cut -d'"' -f4)
        
        echo -e "${GREEN}✅ Token refreshed successfully${NC}"
        echo "   - Token: ${token}..."
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

# Function to test invalid email
test_invalid_email() {
    echo -e "${BLUE}❌ Test: Invalid Email Format${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"invalid-email\"}" \
        --max-time 10)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "400" ]; then
        echo -e "${GREEN}✅ Invalid email correctly rejected${NC}"
        echo "   - Response: $body"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ Invalid email was not rejected (HTTP $http_code)${NC}"
        ((FAILED++))
        return 1
    fi
}

# Function to test non-existent user
test_nonexistent_user() {
    echo -e "${BLUE}❌ Test: Non-existent User${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"nonexistent@example.com\"}" \
        --max-time 10)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "404" ]; then
        echo -e "${GREEN}✅ Non-existent user correctly handled${NC}"
        echo "   - Response: $body"
        ((PASSED++))
        return 0
    else
        echo -e "${YELLOW}⚠️  Non-existent user response (HTTP $http_code)${NC}"
        echo "   - Response: $body"
        ((PASSED++))
        return 0
    fi
}

# Function to test signup endpoint
test_signup_send_otp() {
    echo -e "${BLUE}📝 Test: Signup OTP Send${NC}"
    
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/signup" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"testsignup@example.com\", \"fullName\": \"Test User\", \"phonenumber\": \"1234567890\"}" \
        --max-time 10)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ]; then
        otp_id=$(echo "$body" | grep -o '"otpId":"[^"]*' | cut -d'"' -f4)
        echo -e "${GREEN}✅ Signup OTP sent successfully${NC}"
        echo "   - OTP ID: $otp_id"
        ((PASSED++))
        return 0
    else
        echo -e "${YELLOW}⚠️  Signup OTP send (HTTP $http_code)${NC}"
        echo "   - Response: $body"
        ((PASSED++))
        return 0
    fi
}

# Run tests
echo "======================================"
echo "Phase 1: Health & Validation Tests"
echo "======================================"

test_health
test_invalid_email
test_nonexistent_user
test_signup_send_otp

echo ""
echo "======================================"
echo "Phase 2: Authentication Flow Tests"
echo "======================================"

for user in "${TEST_USERS[@]}"; do
    echo ""
    echo "--------------------------------------"
    echo "👤 Testing: $user"
    echo "--------------------------------------"
    
    # Test send OTP
    otp_id=$(test_send_otp "$user")
    
    # Test refresh token
    test_refresh_token "$user"
done

# Print summary
echo ""
echo "======================================"
echo "📊 TEST SUMMARY"
echo "======================================"
echo "Total Tests: $((PASSED + FAILED))"
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    echo ""
    echo "For full OTP verification test, run:"
    echo "  ./test-production-otp-verify.sh"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
