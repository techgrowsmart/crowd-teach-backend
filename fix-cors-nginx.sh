#!/bin/bash

# Script to fix CORS issue by updating nginx configuration on EC2 server

echo "🔧 Fixing CORS configuration on EC2 server..."

# EC2 Server details
EC2_USER="ec2-user"
EC2_HOST="16.171.57.134"
SSH_KEY="/Users/matul/Downloads/gogrowsmart-key.pem"
NGINX_CONF_PATH="/etc/nginx/nginx.conf"
BACKUP_CONF_PATH="/etc/nginx/nginx.conf.backup"

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found at $SSH_KEY"
    exit 1
fi

# Backup current nginx config
echo "📦 Backing up current nginx configuration..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo cp ${NGINX_CONF_PATH} ${BACKUP_CONF_PATH}"

# Upload new nginx configuration
echo "📤 Uploading new nginx configuration..."
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no nginx.conf ${EC2_USER}@${EC2_HOST}:/tmp/nginx.conf

# Move new configuration to nginx directory
echo "🔄 Applying new nginx configuration..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo mv /tmp/nginx.conf ${NGINX_CONF_PATH}"

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo nginx -t"

if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration test passed"
    # Reload nginx
    echo "🔄 Reloading nginx..."
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo systemctl reload nginx"
    echo "✅ Nginx reloaded successfully"
else
    echo "❌ Nginx configuration test failed, restoring backup..."
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo mv ${BACKUP_CONF_PATH} ${NGINX_CONF_PATH}"
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "sudo systemctl reload nginx"
    exit 1
fi

echo "✅ CORS fix applied successfully!"
