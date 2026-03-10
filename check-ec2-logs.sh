#!/bin/bash

# EC2 Log Checking Script
# Replace with your actual EC2 IP and key file

EC2_IP="16.171.57.134"
KEY_FILE="gogrowsmart-key.pem"

echo "🔍 Checking EC2 instance logs..."

# SSH commands to run on EC2
ssh -i $KEY_FILE ec2-user@$EC2_IP << 'EOF'
echo "=== Docker Status ==="
docker ps -a

echo -e "\n=== Docker Compose Status ==="
cd /home/ec2-user/crowd-teach-gogrowsmart-backend
docker-compose ps

echo -e "\n=== Redis Container Logs ==="
docker-compose logs redis

echo -e "\n=== App Container Logs ==="
docker-compose logs app

echo -e "\n=== System Resources ==="
free -h
df -h

echo -e "\n=== Network Connections ==="
netstat -tlnp | grep -E ':(3000|6379)'

echo -e "\n=== PM2 Status (if running) ==="
pm2 status 2>/dev/null || echo "PM2 not running"
EOF

echo "✅ Log check complete"
