#!/bin/bash

# EC2 Deployment Script for Crowd-teach Backend
echo "🚀 Starting EC2 deployment..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker and Docker Compose
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
fi

if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Create certs directory for SSL
mkdir -p certs

# Copy SSL certificates (you need to place your cert files here)
# sudo cp /path/to/your/privkey.pem certs/
# sudo cp /path/to/your/fullchain.pem certs/
# sudo chmod 600 certs/*

# Stop existing services
sudo docker-compose down

# Pull latest changes
git pull origin main

# Build and start services
echo "🔨 Building and starting services..."
sudo docker-compose up --build -d

# Show logs
echo "📋 Showing logs..."
sudo docker-compose logs -f

echo "✅ Deployment complete!"
echo "🌐 Backend should be running on port 3000"
echo "🔴 Redis should be running on port 6379"
