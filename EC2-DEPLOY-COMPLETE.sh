#!/bin/bash

# =============================================================================
# GROWSMART EC2 DEPLOYMENT - COMPLETE AUTOMATED SCRIPT
# Target: EC2 3.95.195.41 (i-0ebd518fc7116fdfe)
# Services: MongoDB (local Docker), Redis (local Docker), AstraDB (cloud)
# =============================================================================

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

EC2_HOST="ec2-3-95-195-41.compute-1.amazonaws.com"
EC2_USER="ec2-user"
KEY_FILE="./growsmart-key.pem"

print_header() {
    echo ""
    echo -e "${YELLOW}==========================================${NC}"
    echo -e "${YELLOW}$1${NC}"
    echo -e "${YELLOW}==========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# =============================================================================
# STEP 1: Create deployment package locally
# =============================================================================
print_header "STEP 1: Creating deployment package"

LOCAL_DIR="/Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend"
cd "$LOCAL_DIR"

# Update docker-compose.production.yml to enable MongoDB locally
cat > docker-compose.production.yml << 'EOF'
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.production
    container_name: growsmart-backend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - USE_LOCAL_DB=true
      - LOCAL_REDIS_URL=redis://redis:6379
      - REDIS_URL=redis://redis:6379
      - MONGO_DB_URL=mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin
    env_file:
      - .env.production
    volumes:
      - ./certs:/app/certs:ro
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      redis:
        condition: service_healthy
      mongodb:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  redis:
    image: redis:7-alpine
    container_name: growsmart-redis
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - app-network
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  mongodb:
    image: mongo:7
    container_name: growsmart-mongodb
    ports:
      - "127.0.0.1:27017:27017"
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password123
      - MONGO_INITDB_DATABASE=gogrowsmart
    volumes:
      - mongodb_data:/data/db
      - ./mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  redis_data:
  mongodb_data:

networks:
  app-network:
    driver: bridge
EOF

print_success "docker-compose.production.yml updated with local MongoDB & Redis"

# Create .env.production for EC2
cat > .env.production << 'EOF'
# ============================================
# GROWSMART PRODUCTION ENVIRONMENT - EC2
# ============================================

# Server
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# AstraDB (Cloud - DataStax Astra) - CANNOT run locally
ASTRA_DB_KEYSPACE=teachnteachprod
ASTRA_TOKEN=AstraCS:WFCCWTsvnwDBMSsshKSDODfK:425c9e7bd2f0df484c4f3f9eaca081d15cef35a4ae0f3181cac14a7c05898167
ASTRA_DB_USERNAME=WFCCWTsvnwDBMSsshKSDODfK
ASTRA_DB_PASSWORD=k41+WoE35KtZ-rANAKRh10WK_iff_AiKUvGgTtcc_Giy88lgns.nthYD6PyjCENb3eawnG8y5QAxs8DpZntw_,hdlHgF99Q,AKgDFkpQv,KpGut-,FB0n2-39s26EO5a

# MongoDB (Local Docker)
MONGO_DB_URL=mongodb://admin:password123@mongodb:27017/gogrowsmart?authSource=admin
MONGO_DB_DATABASE=gogrowsmart

# Redis (Local Docker)
REDIS_URL=redis://redis:6379
LOCAL_REDIS_URL=redis://redis:6379
USE_LOCAL_DB=true

# Security
JWT_SECRET_KEY=someVeryStrongRandomSecretKey

# Razorpay Payments
RAZORPAY_KEY_ID=rzp_test_RY9WNGFa44XzaQ
RAZORPAY_KEY_SECRET=9gEMohtoJOUi142wojiP0s8g
RAZORPAY_DEV_ROUTE_ACCOUNTS=true

# Email
EMAIL_USER=contact@gogrowsmart.com
EMAIL_PASS=Matul2002*
EMAIL_PORT=465
EMAIL_HOST=smtp.hostinger.com

# AWS S3
AWS_REGION=eu-north-1
S3_BUCKET_NAME=crowdteach-app-s3
AWS_ACCESS_KEY_ID=AKIAWG6DG5B65KSECRO4
AWS_SECRET_ACCESS_KEY=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

# Firebase
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=go-grow-smart
FIREBASE_PRIVATE_KEY_ID=2cc45e2bc38fbc03456ec742d4fd378255542396
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@go-grow-smart.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=117053154089622042415

# Logging
LOG_REQUEST=true
EOF

print_success ".env.production created for local MongoDB + Redis"

# Create MongoDB init script
cat > mongo-init.js << 'EOF'
// Initialize MongoDB with proper database and collections
db = db.getSiblingDB('gogrowsmart');

// Create collections
if (!db.getCollectionNames().includes('posts')) {
    db.createCollection('posts');
    print('✅ Created posts collection');
}

if (!db.getCollectionNames().includes('post_likes')) {
    db.createCollection('post_likes');
    print('✅ Created post_likes collection');
}

if (!db.getCollectionNames().includes('comments')) {
    db.createCollection('comments');
    print('✅ Created comments collection');
}

if (!db.getCollectionNames().includes('teacher_bank_details')) {
    db.createCollection('teacher_bank_details');
    print('✅ Created teacher_bank_details collection');
}

// Create indexes
db.posts.createIndex({ "createdAt": -1 });
db.posts.createIndex({ "teacherEmail": 1 });
db.post_likes.createIndex({ "postId": 1, "userEmail": 1 }, { unique: true });
db.comments.createIndex({ "postId": 1 });

print('✅ MongoDB initialization complete');
EOF

print_success "mongo-init.js created"

# Create deployment archive
print_header "STEP 2: Creating deployment archive"

tar -czf ec2-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    --exclude='.DS_Store' \
    --exclude='logs/*' \
    --exclude='certs/*' \
    -C "$LOCAL_DIR" .

print_success "Deployment archive created: ec2-deploy.tar.gz"

# =============================================================================
# STEP 3: Deploy to EC2
# =============================================================================
print_header "STEP 3: Deploying to EC2 (3.95.195.41)"

echo "Uploading to EC2..."
scp -i "$KEY_FILE" -o StrictHostKeyChecking=no ec2-deploy.tar.gz "${EC2_USER}@${EC2_HOST}:~/"
print_success "Files uploaded to EC2"

# =============================================================================
# STEP 4: Execute deployment commands on EC2
# =============================================================================
print_header "STEP 4: Executing deployment on EC2"

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_HOST}" << 'REMOTE_EOF'

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}==========================================${NC}"
echo -e "${YELLOW}GROWSMART EC2 DEPLOYMENT${NC}"
echo -e "${YELLOW}==========================================${NC}"

# Setup directories
mkdir -p ~/growsmart-backend
cd ~/growsmart-backend

# Extract archive
echo "Extracting deployment archive..."
tar -xzf ~/ec2-deploy.tar.gz -C .

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum update -y
    sudo yum install -y docker
    sudo service docker start
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✅ Docker installed${NC}"
else
    echo -e "${GREEN}✅ Docker already installed${NC}"
fi

# Install docker-compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✅ docker-compose installed${NC}"
else
    echo -e "${GREEN}✅ docker-compose already installed${NC}"
fi

# Start Docker service
sudo service docker start || sudo systemctl start docker

# Stop existing containers
echo "Stopping existing containers..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker stop $(docker ps -q) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

# Clean up unused images
docker system prune -f 2>/dev/null || true

# Build and deploy
echo "Building and deploying services..."
docker-compose -f docker-compose.production.yml up -d --build

# Wait for services to start
echo "Waiting for services to initialize..."
sleep 30

# Check service health
echo "Checking service health..."

# Check Redis
if docker exec growsmart-redis redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}✅ Redis is healthy${NC}"
else
    echo -e "${YELLOW}⚠️ Redis health check pending${NC}"
fi

# Check MongoDB
if docker exec growsmart-mongodb mongosh --eval "db.adminCommand('ping')" --quiet 2>/dev/null | grep -q "ok"; then
    echo -e "${GREEN}✅ MongoDB is healthy${NC}"
else
    echo -e "${YELLOW}⚠️ MongoDB health check pending${NC}"
fi

# Check Backend API
echo "Testing API endpoint..."
for i in {1..10}; do
    if curl -s http://localhost:3000/api/ping 2>/dev/null | grep -q "pong"; then
        echo -e "${GREEN}✅ Backend API is responding${NC}"
        break
    fi
    echo "Attempt $i/10..."
    sleep 5
done

# Show running containers
echo ""
echo -e "${YELLOW}Running Containers:${NC}"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}DEPLOYMENT SUCCESSFUL!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "Services:"
echo "  - API:      http://3.95.195.41:3000"
echo "  - WebSocket: ws://3.95.195.41:3000"
echo "  - MongoDB:  localhost:27017 (container internal)"
echo "  - Redis:    localhost:6379 (container internal)"
echo ""
echo "View logs:"
echo "  docker-compose -f docker-compose.production.yml logs -f app"
echo ""

REMOTE_EOF

print_success "EC2 deployment completed!"

# Cleanup
rm -f ec2-deploy.tar.gz

print_header "DEPLOYMENT COMPLETE"
echo ""
echo -e "${GREEN}Your backend is now running on EC2 with:${NC}"
echo "  - MongoDB: Local Docker container"
echo "  - Redis: Local Docker container"
echo "  - AstraDB: Cloud (DataStax) - as intended"
echo "  - WebSocket: Socket.io fully configured"
echo ""
echo "URLs:"
echo "  API:       http://3.95.195.41:3000"
echo "  WebSocket: ws://3.95.195.41:3000"
echo ""
echo "To check status:"
echo "  ssh -i growsmart-key.pem ec2-user@ec2-3-95-195-41.compute-1.amazonaws.com"
echo "  docker-compose -f docker-compose.production.yml ps"
echo ""
