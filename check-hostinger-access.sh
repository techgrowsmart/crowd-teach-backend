#!/bin/bash

# Check Hostinger Access Types

echo "=========================================="
echo "HOSTINGER ACCESS CHECK"
echo "=========================================="
echo ""

VPS_IP="88.223.84.61"
FTP_USER="u385735845"
VPS_USER="u385735845"

echo "Testing different connection methods..."
echo ""

# Test 1: SSH on standard port 22
echo "1️⃣ Testing SSH on port 22..."
ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_IP} "echo 'SSH OK'" 2>&1
if [ $? -eq 0 ]; then
    echo "✅ SSH port 22 works!"
else
    echo "❌ SSH port 22 failed"
fi
echo ""

# Test 2: SSH on common alternative ports
echo "2️⃣ Testing SSH on port 65002 (Hostinger common)..."
ssh -p 65002 -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_IP} "echo 'SSH 65002 OK'" 2>&1
if [ $? -eq 0 ]; then
    echo "✅ SSH port 65002 works!"
else
    echo "❌ SSH port 65002 failed"
fi
echo ""

# Test 3: Check if it's actually a VPS or shared hosting
echo "3️⃣ Checking if port 22 is open..."
nc -z -v ${VPS_IP} 22 2>&1
echo ""

echo "=========================================="
echo "DIAGNOSIS:"
echo "=========================================="
echo ""
echo "If all SSH tests failed, you likely have:"
echo "  → Hostinger SHARED HOSTING (no SSH)"
echo "  → OR VPS with different SSH port"
echo "  → OR SSH not enabled"
echo ""
echo "For SHARED HOSTING:"
echo "  • You CANNOT deploy Docker containers"
echo "  • You CAN only upload static files via FTP"
echo "  • Solution: Use Railway/Render instead"
echo ""
echo "For VPS:"
echo "  • Check Hostinger control panel for SSH port"
echo "  • Common ports: 22, 65002, or custom"
echo "  • Try 'ssh -p PORT user@ip' format"
echo ""
echo "=========================================="
