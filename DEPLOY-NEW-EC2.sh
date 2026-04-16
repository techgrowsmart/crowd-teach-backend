#!/bin/bash

# =============================================================================
# GROWSMART NEW EC2 INSTANCE DEPLOYMENT
# Use this after launching your new "Growsmart-prod" instance
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${YELLOW}$1${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if IP is provided
if [ -z "$1" ]; then
    print_error "Please provide the new EC2 IP address"
    echo "Usage: ./DEPLOY-NEW-EC2.sh <EC2_IP_ADDRESS>"
    echo "Example: ./DEPLOY-NEW-EC2.sh 3.95.195.42"
    exit 1
fi

EC2_IP="$1"
EC2_USER="ec2-user"
KEY_FILE="./bin/gogrowsmart-production.pem"

print_header "🚀 DEPLOYING TO NEW EC2: $EC2_IP"

# Step 1: Create deployment package
print_header "STEP 1: Creating deployment package..."

LOCAL_DIR="/Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend"
cd "$LOCAL_DIR"

# Create mongo-init.js if not exists
cat > mongo-init.js << 'EOF'
db = db.getSiblingDB('gogrowsmart');

if (!db.getCollectionNames().includes('posts')) {
    db.createCollection('posts');
    print('Created posts collection');
}

if (!db.getCollectionNames().includes('post_likes')) {
    db.createCollection('post_likes');
    print('Created post_likes collection');
}

if (!db.getCollectionNames().includes('comments')) {
    db.createCollection('comments');
    print('Created comments collection');
}

if (!db.getCollectionNames().includes('teacher_bank_details')) {
    db.createCollection('teacher_bank_details');
    print('Created teacher_bank_details collection');
}

db.posts.createIndex({ "createdAt": -1 });
db.posts.createIndex({ "teacherEmail": 1 });
db.post_likes.createIndex({ "postId": 1, "userEmail": 1 }, { unique: true });
db.comments.createIndex({ "postId": 1 });

print('MongoDB initialization complete');
EOF

print_success "mongo-init.js created"

# Create deployment archive
tar -czf new-ec2-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    --exclude='.DS_Store' \
    --exclude='logs/*' \
    --exclude='certs/*' \
    .

print_success "Deployment package created"

# Step 2: Upload to EC2
print_header "STEP 2: Uploading to EC2 ($EC2_IP)..."

if [ ! -f "$KEY_FILE" ]; then
    print_error "Key file not found: $KEY_FILE"
    echo "Make sure gogrowsmart-production.pem is in the current directory"
    exit 1
fi

scp -i "$KEY_FILE" -o StrictHostKeyChecking=no new-ec2-deploy.tar.gz "${EC2_USER}@${EC2_IP}:~/"
print_success "Files uploaded"

# Step 3: Deploy on EC2
print_header "STEP 3: Deploying on EC2..."

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_IP}" << REMOTE_SCRIPT

set -e

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum update -y
    sudo yum install -y docker
    sudo service docker start
    sudo usermod -aG docker \$USER
fi

# Install docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo "Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Start Docker
sudo service docker start

# Setup directory
mkdir -p ~/growsmart-backend
cd ~/growsmart-backend

# Extract
tar -xzf ~/new-ec2-deploy.tar.gz -C .

# Stop any existing containers
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker stop \$(docker ps -q) 2>/dev/null || true

# Deploy
docker-compose -f docker-compose.production.yml up -d --build

# Wait for startup
sleep 25

# Check status
echo ""
echo "Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}"

# Test endpoints
echo ""
echo "Testing API..."
curl -s http://localhost:3000/api/ping || echo "API not ready yet"

echo ""
echo "=========================================="
echo "DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "Services running:"
echo "  API:       http://$EC2_IP:3000"
echo "  WebSocket: ws://$EC2_IP:3000"
echo ""
echo "View logs:"
echo "  docker-compose -f docker-compose.production.yml logs -f"

REMOTE_SCRIPT

# Cleanup
rm -f new-ec2-deploy.tar.gz

print_header "✅ DEPLOYMENT COMPLETE!"
echo ""
echo "Your backend is now running at:"
echo "  API:       http://$EC2_IP:3000"
echo "  WebSocket: ws://$EC2_IP:3000"
echo ""
echo "Test it:"
echo "  curl http://$EC2_IP:3000/api/ping"
echo ""
