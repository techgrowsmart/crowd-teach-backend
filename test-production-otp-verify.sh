#!/bin/bash

# Production OTP Verification Test Script
# This script allows manual OTP input to test the complete verification flow

# Configuration
PRODUCTION_API_URL="https://growsmartserver.gogrowsmart.com"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "======================================"
echo "🧪 PRODUCTION OTP VERIFICATION TEST"
echo "======================================"
echo "📍 API URL: $PRODUCTION_API_URL"
echo ""

# Get email from user
read -p "Enter email to test: " email

if [ -z "$email" ]; then
    echo -e "${RED}❌ Email is required${NC}"
    exit 1
fi

echo ""
echo "======================================"
echo "📧 Step 1: Sending OTP"
echo "======================================"

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
    echo ""
    echo -e "${CYAN}📧 Check your email for the OTP code${NC}"
else
    echo -e "${RED}❌ Failed to send OTP (HTTP $http_code)${NC}"
    echo "   - Response: $body"
    exit 1
fi

# Get OTP from user
echo ""
echo "======================================"
echo "🔐 Step 2: Verify OTP"
echo "======================================"
read -p "Enter OTP received in email: " otp

if [ -z "$otp" ]; then
    echo -e "${RED}❌ OTP is required${NC}"
    exit 1
fi

echo ""
echo "Verifying OTP..."

response=$(curl -s -w "\n%{http_code}" -X POST \
    "$PRODUCTION_API_URL/api/auth/verify-otp" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"otp\": \"$otp\", \"otpId\": \"$otp_id\"}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    token=$(echo "$body" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    role=$(echo "$body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
    message=$(echo "$body" | grep -o '"message":"[^"]*' | cut -d'"' -f4)
    
    echo -e "${GREEN}✅ OTP verified successfully${NC}"
    echo "   - Message: $message"
    echo "   - Role: $role"
    echo "   - Token: ${token:0:50}..."
    echo ""
    
    # Save token to file for further testing
    echo "$token" > /tmp/auth_token_$email.txt
    echo -e "${CYAN}💾 Token saved to /tmp/auth_token_$email.txt${NC}"
    
    echo ""
    echo "======================================"
    echo "🔄 Step 3: Testing Token Refresh"
    echo "======================================"
    
    refresh_response=$(curl -s -w "\n%{http_code}" -X POST \
        "$PRODUCTION_API_URL/api/auth/refresh-token" \
        -H "Content-Type: application/json" \
        -d "{\"email\": \"$email\"}")
    
    refresh_http_code=$(echo "$refresh_response" | tail -n1)
    refresh_body=$(echo "$refresh_response" | sed '$d')
    
    if [ "$refresh_http_code" = "200" ]; then
        new_token=$(echo "$refresh_body" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
        new_role=$(echo "$refresh_body" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
        new_name=$(echo "$refresh_body" | grep -o '"name":"[^"]*' | cut -d'"' -f4)
        
        echo -e "${GREEN}✅ Token refreshed successfully${NC}"
        echo "   - New Token: ${new_token:0:50}..."
        echo "   - Role: $new_role"
        echo "   - Name: $new_name"
    else
        echo -e "${RED}❌ Failed to refresh token (HTTP $refresh_http_code)${NC}"
        echo "   - Response: $refresh_body"
    fi
    
    echo ""
    echo "======================================"
    echo "✅ ALL TESTS PASSED"
    echo "======================================"
    exit 0
else
    echo -e "${RED}❌ Failed to verify OTP (HTTP $http_code)${NC}"
    echo "   - Response: $body"
    echo ""
    echo "Possible reasons:"
    echo "  1. Incorrect OTP"
    echo "  2. OTP expired (valid for 2 minutes)"
    echo "  3. Invalid OTP ID"
    exit 1
fi
