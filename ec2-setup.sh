#!/bin/bash

# EC2 Server Setup Script for GoGrowSmart Backend
# Run this once on the EC2 instance

set -e

echo "🔧 Setting up EC2 server for GoGrowSmart Backend..."

# Update system
echo "📦 Updating system packages..."
sudo yum update -y

# Install Node.js
echo "📦 Installing Node.js..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install Nginx for SSL termination (if needed)
echo "📦 Installing Nginx..."
sudo yum install -y nginx

# Create application directory
echo "📁 Creating application directory..."
sudo mkdir -p /home/ec2-user/crowd-teach-gogrowsmart-backend
sudo chown -R ec2-user:ec2-user /home/ec2-user/crowd-teach-gogrowsmart-backend

# Setup SSL certificates directory
echo "🔒 Setting up SSL certificates directory..."
sudo mkdir -p /home/ec2-user/certs
sudo chown -R ec2-user:ec2-user /home/ec2-user/certs

# Setup firewall
echo "🔥 Configuring firewall..."
sudo yum install -y firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload

# Configure PM2 to start on boot
echo "🚀 Configuring PM2 startup..."
pm2 startup
env | grep PM2 | sudo tee /etc/systemd/system/pm2-ec2-user.service

# Create log rotation
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/crowdteach-backend << EOF
/home/ec2-user/.pm2/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 ec2-user ec2-user
}
EOF

echo "✅ EC2 server setup completed!"
echo "📝 Next steps:"
echo "   1. Copy your SSL certificates to /home/ec2-user/certs/"
echo "   2. Run deploy.sh from your local machine"
echo "   3. Ensure your domain DNS points to this EC2 instance"
