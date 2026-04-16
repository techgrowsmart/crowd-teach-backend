# EC2 Deployment Guide - GoGrowSmart Backend

## Target Instance
- **Instance**: i-0ebd518fc7116fdfe (growsmart)
- **Public IP**: 3.95.195.41
- **Public DNS**: ec2-3-95-195-41.compute-1.amazonaws.com

## Architecture Overview

| Service | Location | Type |
|---------|----------|------|
| **AstraDB** | DataStax Cloud | Cloud (no local version available) |
| **MongoDB** | Docker Container | Local |
| **Redis** | Docker Container | Local |
| **Backend API** | Docker Container | Local |
| **WebSocket** | Built-in Socket.io | Local |

---

## Quick Deploy (One Command)

```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
chmod +x EC2-DEPLOY-COMPLETE.sh
./EC2-DEPLOY-COMPLETE.sh
```

---

## Manual Deploy Steps

### Step 1: SSH into EC2

```bash
ssh -i growsmart-key.pem ec2-user@ec2-3-95-195-41.compute-1.amazonaws.com
```

### Step 2: Update docker-compose.production.yml

On your **local machine**, update the file to enable MongoDB:

```yaml
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
```

### Step 3: Create .env.production

```env
# Server
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# AstraDB (Cloud - cannot be local)
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

# Razorpay
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
```

### Step 4: Upload to EC2

```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend

# Create archive
tar -czf ec2-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    .

# Upload
scp -i growsmart-key.pem ec2-deploy.tar.gz ec2-user@ec2-3-95-195-41.compute-1.amazonaws.com:~/
```

### Step 5: Deploy on EC2

```bash
ssh -i growsmart-key.pem ec2-user@ec2-3-95-195-41.compute-1.amazonaws.com

# On EC2:
cd ~
mkdir -p growsmart-backend
cd growsmart-backend
tar -xzf ~/ec2-deploy.tar.gz

# Ensure Docker is running
sudo service docker start

# Stop existing
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker stop $(docker ps -q) 2>/dev/null || true

# Deploy
docker-compose -f docker-compose.production.yml up -d --build

# Wait and verify
sleep 20
curl http://localhost:3000/api/ping
```

---

## Post-Deployment Verification

### Check All Services

```bash
# SSH into EC2
ssh -i growsmart-key.pem ec2-user@ec2-3-95-195-41.compute-1.amazonaws.com

# Check containers
docker-compose -f docker-compose.production.yml ps

# Check logs
docker-compose -f docker-compose.production.yml logs -f app

# Test Redis
docker exec growsmart-redis redis-cli ping

# Test MongoDB
docker exec growsmart-mongodb mongosh --eval "db.adminCommand('ping')"

# Test API
curl http://localhost:3000/api/ping
curl http://localhost:3000/health
```

### Test WebSocket

```bash
# Install wscat if needed
npm install -g wscat

# Test WebSocket connection
wscat -c "ws://3.95.195.41:3000/socket.io/?EIO=4&transport=websocket"
```

---

## Service URLs After Deployment

| Service | URL | Notes |
|---------|-----|-------|
| API | http://3.95.195.41:3000 | Main backend API |
| WebSocket | ws://3.95.195.41:3000 | Socket.io real-time |
| Health Check | http://3.95.195.41:3000/health | Service status |
| Ping | http://3.95.195.41:3000/api/ping | Quick test |

---

## Troubleshooting

### Container Won't Start
```bash
docker-compose -f docker-compose.production.yml logs app
```

### Redis Connection Issues
```bash
docker exec growsmart-redis redis-cli ping
docker exec growsmart-backend env | grep REDIS
```

### MongoDB Connection Issues
```bash
docker exec growsmart-mongodb mongosh --eval "show dbs"
docker exec growsmart-backend env | grep MONGO
```

### Restart All Services
```bash
docker-compose -f docker-compose.production.yml restart
```

### Rebuild Everything
```bash
docker-compose -f docker-compose.production.yml down
docker system prune -f
docker-compose -f docker-compose.production.yml up -d --build
```
