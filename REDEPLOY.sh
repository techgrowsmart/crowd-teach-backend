#!/bin/bash

# EC2 COMPLETE REDEPLOYMENT SCRIPT
# This will completely redeploy your backend with latest changes from GitHub

echo "🚀 Starting complete redeployment of GoGrowSmart Backend..."

# 1. SSH into your EC2 instance and run these commands:
echo ""
echo "📋 STEP 1: SSH into your EC2 instance:"
echo "ssh -i your-key.pem ec2-user@16.171.57.134"
echo ""

# 2. Stop existing processes and clean up
echo "📋 STEP 2: Stop existing processes and clean up"
cat << 'EOF'
# Stop existing PM2 processes
pm2 stop all
pm2 delete all
pm2 kill

# Kill any existing Node.js processes on port 3000
sudo lsof -ti:3000 | xargs kill -9
sudo lsof -ti:443 | xargs kill -9

# Navigate to project directory
cd /home/ec2-user

# Backup current version (optional)
sudo cp -r crowd-teach-gogrowsmart-backend crowd-teach-gogrowsmart-backend-backup-$(date +%Y%m%d-%H%M%S)

# Remove old code
sudo rm -rf crowd-teach-gogrowsmart-backend

EOF

# 3. Clone latest code and setup
echo "📋 STEP 3: Clone latest code and setup"
cat << 'EOF'
# Clone latest code from GitHub
git clone https://github.com/Scoder6/crowd-teach-gogrowsmart-backend.git
cd crowd-teach-gogrowsmart-backend

# Install dependencies
npm ci --production

# Ensure certs directory exists
sudo mkdir -p /home/ec2-user/certs
sudo chown -R ec2-user:ec2-user /home/ec2-user/certs

# Make sure SSL certificates are in place
# If you don't have certificates, generate self-signed ones for now:
if [ ! -f "/home/ec2-user/certs/privkey.pem" ]; then
    echo "⚠️  SSL certificates not found. Generating self-signed certificates..."
    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /home/ec2-user/certs/privkey.pem \
        -out /home/ec2-user/certs/fullchain.pem \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=growsmartserver.gogrowsmart.com"
    sudo chown -R ec2-user:ec2-user /home/ec2-user/certs
fi

EOF

# 4. Setup and configure nginx
echo "📋 STEP 4: Setup and configure nginx"
cat << 'EOF'
# Install nginx if not already installed
sudo yum install -y nginx

# Backup existing nginx config
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true

# Copy nginx configuration
sudo cp nginx.conf /etc/nginx/nginx.conf

# Test nginx configuration
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
sudo systemctl enable nginx

EOF

# 5. Start the application
echo "📋 STEP 5: Start the application"
cat << 'EOF'
# Start the application with PM2
pm2 start app.js --name backend

# Save PM2 configuration
pm2 save
pm2 startup

# Check status
pm2 status
pm2 logs backend --lines 20

EOF

# 6. Test the deployment
echo "📋 STEP 6: Test the deployment"
cat << 'EOF'
# Test local connection
curl http://localhost:3000/api/ping

# Test external connection
curl https://growsmartserver.gogrowsmart.com/api/ping

# Check nginx status
sudo systemctl status nginx

# Check PM2 status
pm2 status

EOF

echo ""
echo "✅ COMPLETE! Your server should now be accessible at:"
echo "🌐 https://growsmartserver.gogrowsmart.com"
echo ""
echo "🔍 If you still face issues, check:"
echo "1. PM2 logs: pm2 logs backend"
echo "2. Nginx logs: sudo tail -f /var/log/nginx/error.log"
echo "3. EC2 Security Groups (ports 80, 443, 3000 open)"
echo ""
