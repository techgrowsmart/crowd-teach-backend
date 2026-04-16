# GROWSMART PRODUCTION DEPLOYMENT GUIDE

## Overview
Complete production deployment with Docker, Redis, AstraDB, MongoDB, and WebSocket on EC2.

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         EC2 SERVER                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Backend App   │◄──►│  Redis Cache    │    │  MongoDB    │ │
│  │   (Docker)      │    │   (Docker)      │    │  (Atlas)    │ │
│  │   Port: 3000    │    │   Port: 6379    │    │  (Cloud)    │ │
│  └────────┬────────┘    └─────────────────┘    └─────────────┘ │
│           │                                                     │
│           │    ┌─────────────────┐                             │
│           └───►│  AstraDB (Cass.)│                             │
│                │   (Cloud)       │                             │
│                └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  CloudFront/ALB │
                    │   SSL (HTTPS)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │portal.gogrowsmart│
                    │      .com       │
                    └─────────────────┘
```

## WebSocket Configuration

The WebSocket runs on the **SAME PORT** as the HTTP API (3000).

### For Production (WSS - Secure WebSocket):
```
Frontend: wss://growsmartserver.gogrowsmart.com
         └── SSL terminates at CloudFront/ALB
         └── Routes to EC2:3000
         └── Socket.IO handles both HTTP and WebSocket
```

### Socket.IO Configuration (socket.js):
- **URL**: `wss://growsmartserver.gogrowsmart.com` (production)
- **Port**: Same as API (3000) - no separate port needed
- **Transports**: `['websocket', 'polling']`
- **CORS**: All `*.gogrowsmart.com` domains allowed

## Prerequisites

1. **EC2 Instance** (Amazon Linux 2 or Ubuntu)
   - t3.medium or higher recommended
   - Security Group: Allow ports 22, 80, 443, 3000

2. **Domain & SSL**
   - Domain: `growsmartserver.gogrowsmart.com` → EC2 IP
   - SSL certificate (Let's Encrypt or AWS ACM)

3. **Databases**
   - AstraDB: Already configured (Cassandra)
   - MongoDB Atlas: Already configured
   - Redis: Will run in Docker locally

## Deployment Steps

### Step 1: Connect to EC2
```bash
ssh -i your-key.pem ec2-user@growsmartserver.gogrowsmart.com
# or
ssh -i your-key.pem ubuntu@growsmartserver.gogrowsmart.com
```

### Step 2: Clone/Update Repository
```bash
cd /home/ec2-user
git clone https://github.com/your-repo/crowd-teach-gogrowsmart-backend.git
cd crowd-teach-gogrowsmart-backend
```

### Step 3: Run Deployment Script
```bash
# Make script executable
chmod +x deploy-ec2-docker.sh

# Run deployment
./deploy-ec2-docker.sh
```

### Step 4: Verify Deployment
```bash
# Check containers
docker-compose -f docker-compose.production.yml ps

# Check logs
docker-compose -f docker-compose.production.yml logs -f app

# Test API
curl http://localhost:3000/api/ping

# Test WebSocket (using wscat)
npm install -g wscat
wscat -c ws://localhost:3000
```

## Environment Variables

Create `.env.production` on EC2:
```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# AstraDB (Cassandra)
ASTRA_DB_KEYSPACE=teachnteachprod
ASTRA_TOKEN=your_astra_token
ASTRA_DB_USERNAME=your_astra_username
ASTRA_DB_PASSWORD=your_astra_password

# MongoDB Atlas
MONGO_DB_URL=mongodb+srv://user:pass@cluster.mongodb.net/GrowThoughts
MONGO_DB_DATABASE=GrowThoughts

# Redis (Docker local)
LOCAL_REDIS_URL=redis://redis:6379
REDIS_URL=redis://redis:6379

# JWT
JWT_SECRET_KEY=your_jwt_secret

# Payments
RAZORPAY_KEY_ID=your_key
RAZORPAY_KEY_SECRET=your_secret

# Email
EMAIL_USER=contact@gogrowsmart.com
EMAIL_PASS=your_password
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=465

# AWS S3
AWS_REGION=eu-north-1
S3_BUCKET_NAME=your_bucket
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```

## SSL Configuration (Let's Encrypt)

```bash
# Install certbot
sudo yum install certbot -y

# Obtain certificate
sudo certbot certonly --standalone -d growsmartserver.gogrowsmart.com

# Certificates will be at:
# /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/fullchain.pem
# /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/privkey.pem

# Copy to app directory
sudo cp /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/*.pem ./certs/
sudo chown ec2-user:ec2-user ./certs/*
```

## Nginx Reverse Proxy (Optional)

If using Nginx in front of the app:

```nginx
server {
    listen 443 ssl http2;
    server_name growsmartserver.gogrowsmart.com;

    ssl_certificate /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}

# WebSocket support
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## Monitoring

```bash
# View container stats
docker stats

# View logs
docker-compose -f docker-compose.production.yml logs -f app
docker-compose -f docker-compose.production.yml logs -f redis

# Redis CLI
docker-compose -f docker-compose.production.yml exec redis redis-cli

# Restart services
docker-compose -f docker-compose.production.yml restart
```

## Troubleshooting

### Container won't start:
```bash
docker-compose -f docker-compose.production.yml logs app
cat logs/*.log
```

### Redis connection issues:
```bash
docker-compose -f docker-compose.production.yml exec redis redis-cli ping
```

### WebSocket not connecting:
```bash
# Check CORS in socket.js and app.js
# Verify domain is in CORS whitelist
# Test with: wscat -c ws://localhost:3000
```

## Updates & Redeployment

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
./deploy-ec2-docker.sh

# Or quick restart without rebuild
docker-compose -f docker-compose.production.yml restart
```
