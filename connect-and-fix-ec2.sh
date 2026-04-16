#!/bin/bash

# =============================================================================
# Connect to EC2 using DIRECT IP (bypassing DNS issues)
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# CORRECT EC2 IP (as provided by user)
EC2_IP="16.171.57.134"
EC2_USER="ec2-user"
KEY_FILE=""

print_status() {
    local status="$1"
    local message="$2"
    case $status in
        "SUCCESS") echo -e "${GREEN}✅ $message${NC}" ;;
        "WARNING") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "ERROR") echo -e "${RED}❌ $message${NC}" ;;
        "INFO") echo -e "${BLUE}ℹ️  $message${NC}" ;;
    esac
}

# Find the correct key file
if [ -f "./gogrowsmart-key.pem" ]; then
    KEY_FILE="./gogrowsmart-key.pem"
elif [ -f "./growsmart-key.pem" ]; then
    KEY_FILE="./growsmart-key.pem"
else
    print_status "ERROR" "No SSH key file found (looking for gogrowsmart-key.pem or growsmart-key.pem)"
    exit 1
fi

print_status "INFO" "Using key file: $KEY_FILE"
print_status "INFO" "Target EC2 IP: $EC2_IP"

# Ensure key has correct permissions
if [ "$(stat -c %a "$KEY_FILE" 2>/dev/null || stat -f %Lp "$KEY_FILE")" != "600" ]; then
    print_status "WARNING" "Key file permissions need fixing..."
    chmod 600 "$KEY_FILE"
    print_status "SUCCESS" "Key permissions fixed (600)"
fi

# Test connection with ec2-user first
print_status "INFO" "Testing SSH connection to $EC2_USER@$EC2_IP..."
if ssh -i "$KEY_FILE" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_USER@$EC2_IP" "echo 'SSH connection successful'" 2>/dev/null; then
    print_status "SUCCESS" "Connected with ec2-user!"
else
    # Try with ubuntu user
    EC2_USER="ubuntu"
    print_status "INFO" "Trying with ubuntu user..."
    if ssh -i "$KEY_FILE" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$EC2_USER@$EC2_IP" "echo 'SSH connection successful'" 2>/dev/null; then
        print_status "SUCCESS" "Connected with ubuntu!"
    else
        print_status "ERROR" "Cannot connect to EC2 at $EC2_IP"
        print_status "ERROR" "Possible issues:"
        print_status "ERROR" "  1. Instance is stopped or terminated"
        print_status "ERROR" "  2. Security group doesn't allow SSH (port 22)"
        print_status "ERROR" "  3. Wrong key file"
        print_status "ERROR" "  4. Instance doesn't have a public IP attached"
        exit 1
    fi
fi

# Connection successful - now let's diagnose and fix
print_status "INFO" "═══════════════════════════════════════════════════════"
print_status "INFO" "CONNECTED! Running diagnostics..."
print_status "INFO" "═══════════════════════════════════════════════════════"

# Run diagnostics remotely
ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP" << 'REMOTECOMMANDS'
    echo ""
    echo "=== SYSTEM INFO ==="
    echo "Hostname: $(hostname)"
    echo "OS: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'"' -f2 || echo 'Unknown')"
    echo "Uptime: $(uptime -p 2>/dev/null || uptime)"
    
    echo ""
    echo "=== DISK SPACE ==="
    df -h /
    
    echo ""
    echo "=== MEMORY ==="
    free -h 2>/dev/null || vm_stat 2>/dev/null | head -5
    
    echo ""
    echo "=== DOCKER STATUS ==="
    if command -v docker &> /dev/null; then
        echo "Docker version: $(docker --version)"
        echo "Docker service: $(systemctl is-active docker 2>/dev/null || echo 'unknown')"
        echo ""
        echo "Running containers:"
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "No containers running"
        echo ""
        echo "All containers (including stopped):"
        docker ps -a --format "table {{.Names}}\t{{.Status}}" 2>/dev/null || echo "None"
    else
        echo "❌ Docker is NOT installed!"
    fi
    
    echo ""
    echo "=== PROJECT DIRECTORY ==="
    if [ -d "~/crowd-teach-gogrowsmart-backend" ]; then
        echo "✅ Project directory exists"
        ls -la ~/crowd-teach-gogrowsmart-backend/ | head -20
    else
        echo "❌ Project directory NOT found!"
    fi
    
    echo ""
    echo "=== NETWORK/PORTS ==="
    echo "Listening on port 3000:"
    ss -tlnp 2>/dev/null | grep 3000 || netstat -tlnp 2>/dev/null | grep 3000 || echo "Port 3000 not listening"
    
    echo ""
    echo "=== NGINX STATUS ==="
    if command -v nginx &> /dev/null; then
        echo "Nginx version: $(nginx -v 2>&1)"
        systemctl status nginx --no-pager 2>/dev/null | head -10 || service nginx status 2>/dev/null || echo "Nginx status unknown"
    else
        echo "Nginx not installed"
    fi
REMOTECOMMANDS

print_status "INFO" "═══════════════════════════════════════════════════════"
print_status "INFO" "Diagnostics complete!"
print_status "INFO" "═══════════════════════════════════════════════════════"

# Ask user what to do next
echo ""
echo "What would you like to do?"
echo "1) Enter interactive SSH shell on EC2"
echo "2) Deploy/Update the application"
echo "3) Fix Docker/Redis issues"
echo "4) Just exit"
echo ""
read -p "Enter choice (1-4): " choice

case $choice in
    1)
        print_status "INFO" "Opening SSH shell..."
        ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP"
        ;;
    2)
        print_status "INFO" "Deploying application..."
        # Sync files
        print_status "INFO" "Syncing files to EC2..."
        rsync -avz --progress \
            -e "ssh -i $KEY_FILE" \
            --exclude='node_modules' \
            --exclude='.git' \
            --exclude='*.log' \
            --exclude='uploads/*' \
            ./ "$EC2_USER@$EC2_IP:~/crowd-teach-gogrowsmart-backend/"
        
        print_status "SUCCESS" "Files synced!"
        print_status "INFO" "Running deployment on EC2..."
        
        ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP" << 'DEPLOYCOMMANDS'
            cd ~/crowd-teach-gogrowsmart-backend
            
            # Check if docker-compose exists
            if [ ! -f "docker-compose.yml" ] && [ ! -f "docker-compose.production.yml" ]; then
                echo "❌ No docker-compose file found!"
                exit 1
            fi
            
            # Stop existing containers
            echo "Stopping existing containers..."
            docker-compose down 2>/dev/null || docker-compose -f docker-compose.production.yml down 2>/dev/null || true
            
            # Rebuild and start
            echo "Building and starting containers..."
            if [ -f "docker-compose.production.yml" ]; then
                docker-compose -f docker-compose.production.yml up -d --build
            else
                docker-compose up -d --build
            fi
            
            echo ""
            echo "=== Container Status ==="
            docker ps
            
            echo ""
            echo "=== Recent Logs ==="
            docker logs --tail 20 $(docker ps -q --filter name=app) 2>/dev/null || echo "Could not get app logs"
DEPLOYCOMMANDS
        
        print_status "SUCCESS" "Deployment complete!"
        ;;
    3)
        print_status "INFO" "Fixing Docker/Redis..."
        ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP" << 'FIXCOMMANDS'
            echo "=== Fixing Docker setup ==="
            
            # Stop all containers
            docker stop $(docker ps -q) 2>/dev/null || true
            docker rm $(docker ps -aq) 2>/dev/null || true
            
            # Clean up
            docker system prune -f
            
            # Navigate to project
            cd ~/crowd-teach-gogrowsmart-backend 2>/dev/null || cd ~
            
            # Start fresh
            if [ -f "docker-compose.yml" ] || [ -f "docker-compose.production.yml" ]; then
                docker-compose down 2>/dev/null || true
                docker-compose -f docker-compose.production.yml up -d --build 2>/dev/null || docker-compose up -d --build
                
                echo ""
                echo "=== Testing Redis ==="
                sleep 5
                docker-compose exec -T redis redis-cli ping 2>/dev/null || echo "Redis check failed"
            else
                echo "No docker-compose file found in $(pwd)"
            fi
            
            echo ""
            echo "=== Final Status ==="
            docker ps
FIXCOMMANDS
        print_status "SUCCESS" "Fix applied!"
        ;;
    4)
        print_status "INFO" "Exiting..."
        exit 0
        ;;
    *)
        print_status "WARNING" "Invalid choice, opening SSH shell..."
        ssh -i "$KEY_FILE" "$EC2_USER@$EC2_IP"
        ;;
esac
