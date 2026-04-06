#!/bin/bash

# ============================================================================
# PRODUCTION DEPLOYMENT SCRIPT FOR CROWD-TEACH BACKEND
# ============================================================================
# This script deploys the backend to EC2 with SSL certificates
# Run this from your local machine, NOT on the server
# ============================================================================

set -e  # Exit on any error

# Configuration
EC2_HOST="16.171.57.134"
EC2_USER="ec2-user"
SSH_KEY="~/.ssh/gogrowsmart.pem"  # Update this path to your actual key
REPO_URL="https://github.com/Scoder6/crowd-teach-gogrowsmart-backend.git"
APP_DIR="/home/ec2-user/crowd-teach-gogrowsmart-backend"
CERTS_DIR="/home/ec2-user/certs"

echo "🚀 Starting Production Deployment to EC2"
echo "=========================================="
echo "Host: $EC2_HOST"
echo "User: $EC2_USER"
echo ""

# Check if SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found at $SSH_KEY"
    echo "Please update the SSH_KEY variable in this script"
    exit 1
fi

# Function to run commands on EC2 via SSH
run_remote() {
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_HOST" "$1"
}

# Function to copy files to EC2
copy_to_remote() {
    scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r "$1" "$EC2_USER@$EC2_HOST:$2"
}

echo "📦 Step 1: Preparing deployment package..."

# Create a temporary deployment package
DEPLOY_DIR=$(mktemp -d)
echo "Using temp directory: $DEPLOY_DIR"

# Copy necessary files
cp -r . "$DEPLOY_DIR/" 2>/dev/null || true

# Ensure certs are included
if [ -d "certs" ]; then
    echo "✅ SSL certificates found in certs/"
    ls -la certs/
else
    echo "⚠️  No certs directory found locally"
fi

echo ""
echo "📡 Step 2: Connecting to EC2 and setting up..."

# Update system and install dependencies
run_remote "
    echo '🔄 Updating system...'
    sudo yum update -y
    
    echo '📦 Installing Node.js...'
    if ! command -v node &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo yum install -y nodejs
    fi
    
    echo '📦 Installing PM2...'
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
    fi
    
    echo '📦 Installing Nginx...'
    if ! command -v nginx &> /dev/null; then
        sudo amazon-linux-extras install nginx1 -y
    fi
    
    echo '🔧 Creating directories...'
    sudo mkdir -p $CERTS_DIR
    sudo mkdir -p /var/log/nginx
    sudo chown -R ec2-user:ec2-user $CERTS_DIR
"

echo ""
echo "📋 Step 3: Copying SSL certificates..."

# Copy SSL certificates to EC2
if [ -f "certs/privkey.pem" ] && [ -f "certs/fullchain.pem" ]; then
    scp -i "$SSH_KEY" -o StrictHostKeyChecking=no certs/privkey.pem "$EC2_USER@$EC2_HOST:$CERTS_DIR/"
    scp -i "$SSH_KEY" -o StrictHostKeyChecking=no certs/fullchain.pem "$EC2_USER@$EC2_HOST:$CERTS_DIR/"
    run_remote "sudo chmod 600 $CERTS_DIR/*"
    echo "✅ SSL certificates copied successfully"
else
    echo "⚠️  SSL certificates not found in local certs/ directory"
    echo "Make sure you have privkey.pem and fullchain.pem in the certs/ folder"
fi

echo ""
echo "📥 Step 4: Deploying application code..."

# Clone or update the repository on EC2
run_remote "
    if [ -d '$APP_DIR' ]; then
        echo '🔄 Updating existing repository...'
        cd $APP_DIR
        git pull origin main
    else
        echo '📥 Cloning repository...'
        cd /home/ec2-user
        git clone $REPO_URL
    fi
"

echo ""
echo "📋 Step 5: Installing dependencies..."

run_remote "
    cd $APP_DIR
    echo '📦 Installing npm dependencies...'
    npm ci --production
    
    echo '🔧 Setting correct permissions...'
    sudo chown -R ec2-user:ec2-user $APP_DIR
"

echo ""
echo "🔧 Step 6: Configuring Nginx..."

# Copy nginx configuration
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no nginx.conf "$EC2_USER@$EC2_HOST:/tmp/nginx.conf"

run_remote "
    echo '🔧 Setting up Nginx configuration...'
    sudo mv /tmp/nginx.conf /etc/nginx/nginx.conf
    
    echo '✅ Testing Nginx configuration...'
    sudo nginx -t
    
    echo '🔄 Restarting Nginx...'
    sudo systemctl restart nginx
    sudo systemctl enable nginx
"

echo ""
echo "🚀 Step 7: Starting the application..."

run_remote "
    cd $APP_DIR
    
    echo '🛑 Stopping existing PM2 processes...'
    pm2 stop backend 2>/dev/null || true
    pm2 delete backend 2>/dev/null || true
    
    echo '🚀 Starting backend with PM2...'
    pm2 start app.js --name backend
    pm2 save
    sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
"

echo ""
echo "🔥 Step 8: Configuring firewall..."

run_remote "
    echo '🔥 Setting up firewall...'
    sudo yum install -y firewalld
    sudo systemctl start firewalld
    sudo systemctl enable firewalld
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    sudo firewall-cmd --permanent --add-port=443/tcp
    sudo firewall-cmd --permanent --add-port=3000/tcp
    sudo firewall-cmd --reload
"

echo ""
echo "✅ Deployment Complete!"
echo "======================"
echo ""
echo "🌐 Your backend is now running at:"
echo "   HTTPS: https://growsmartserver.gogrowsmart.com"
echo ""
echo "📋 Useful commands:"
echo "   SSH: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST"
echo "   Logs: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST 'pm2 logs backend'"
echo "   Status: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST 'pm2 status'"
echo ""
echo "🧪 Test the deployment:"
echo "   curl https://growsmartserver.gogrowsmart.com/api/ping"
echo ""
