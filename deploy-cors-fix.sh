#!/bin/bash
# Deploy CORS Fix to EC2 - Fix nginx configuration for local development

set -e

EC2_HOST="ec2-13-201-187-153.ap-south-1.compute.amazonaws.com"
EC2_USER="ec2-user"
KEY_PATH="/Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend/gogrowsmart-key.pem"

echo "=== Deploying CORS Fix to EC2 ==="
echo "EC2 Host: $EC2_HOST"
echo ""

# Check if key exists
if [ ! -f "$KEY_PATH" ]; then
    echo "❌ SSH key not found at $KEY_PATH"
    echo "Please ensure the key file exists"
    exit 1
fi

# Fix permissions on key
chmod 400 "$KEY_PATH"

echo "=== Step 1: Upload fixed nginx.conf ==="
scp -i "$KEY_PATH" -o StrictHostKeyChecking=no \
    /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend/nginx.conf \
    $EC2_USER@$EC2_HOST:/tmp/nginx.conf

echo "=== Step 2: Apply nginx configuration ==="
ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no $EC2_USER@$EC2_HOST << 'EOF'
    echo "Backing up current nginx config..."
    sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
    
    echo "Installing new nginx config..."
    sudo cp /tmp/nginx.conf /etc/nginx/nginx.conf
    
    echo "Testing nginx configuration..."
    sudo nginx -t
    
    if [ $? -eq 0 ]; then
        echo "✅ Nginx config test passed"
        echo "Reloading nginx..."
        sudo systemctl reload nginx
        echo "✅ Nginx reloaded successfully"
    else
        echo "❌ Nginx config test failed - restoring backup"
        sudo cp /etc/nginx/nginx.conf.backup.* /etc/nginx/nginx.conf 2>/dev/null || true
        sudo nginx -t
        exit 1
    fi
    
    echo ""
    echo "=== Nginx Status ==="
    sudo systemctl status nginx --no-pager | head -10
EOF

echo ""
echo "=== ✅ CORS Fix Deployed Successfully ==="
echo ""
echo "The nginx configuration has been updated to allow:"
echo "  - localhost:* (any port)"
echo "  - 127.0.0.1:* (any port)"
echo "  - *.gogrowsmart.com (all subdomains)"
echo "  - gogrowsmart.com (main domain)"
echo ""
echo "Test users should now be able to log in:"
echo "  - teacher56@example.com"
echo "  - student1@example.com"
