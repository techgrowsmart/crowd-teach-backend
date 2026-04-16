# 🚀 DEPLOY NOW - EC2 Production Deployment

## Quick Start (Copy & Paste These Commands)

### Step 1: Fix Key Permissions
```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
chmod 600 gogrowsmart-key.pem growsmart-key.pem
```

### Step 2: Test SSH Connection
```bash
# Try ec2-user first
ssh -i gogrowsmart-key.pem ec2-user@growsmartserver.gogrowsmart.com "echo 'Connected!'"

# If that fails, try ubuntu
ssh -i gogrowsmart-key.pem ubuntu@growsmartserver.gogrowsmart.com "echo 'Connected!'"
```

### Step 3: Deploy Using Automated Script
```bash
# This syncs files and deploys automatically
./deploy-to-ec2.sh
```

### OR Step 3: Manual Deployment
```bash
# SSH into EC2 (use correct user)
ssh -i gogrowsmart-key.pem ec2-user@growsmartserver.gogrowsmart.com

# Once inside EC2:
cd crowd-teach-gogrowsmart-backend

# Stop any running containers
docker-compose -f docker-compose.production.yml down 2>/dev/null || true

# Build and start
docker-compose -f docker-compose.production.yml up -d --build

# Check status
docker-compose -f docker-compose.production.yml ps

# View logs
docker-compose -f docker-compose.production.yml logs -f app
```

## Troubleshooting

### Issue: "Permission denied (publickey)"
**Fix:**
```bash
chmod 600 gogrowsmart-key.pem
# Or try the other key:
ssh -i growsmart-key.pem ec2-user@growsmartserver.gogrowsmart.com
```

### Issue: "Connection refused"
**Fix:** Check EC2 Security Group allows port 22 (SSH)

### Issue: "Docker not found"
**Fix (on EC2):**
```bash
sudo yum install docker -y
sudo systemctl start docker
sudo usermod -aG docker $USER
# Logout and login again
```

### Issue: "Port 3000 already in use"
**Fix (on EC2):**
```bash
# Kill process on port 3000
sudo lsof -ti:3000 | xargs kill -9 2>/dev/null || true
# Then redeploy
```

## Verify Deployment

```bash
# Test API
curl http://localhost:3000/api/ping

# Test WebSocket (install wscat first)
npm install -g wscat
wscat -c ws://localhost:3000

# Check Redis
docker-compose -f docker-compose.production.yml exec redis redis-cli ping
```

## What's Deployed

✅ **Backend API** - Node.js on port 3000  
✅ **Redis** - Caching/Session store  
✅ **AstraDB** - Cassandra (cloud)  
✅ **MongoDB Atlas** - Posts database (cloud)  
✅ **WebSocket** - Socket.IO on same port  

## WebSocket URL

Production: `wss://growsmartserver.gogrowsmart.com`
- Same port as API (3000 internally)
- SSL terminates at CloudFront/ALB
- Socket.IO handles the upgrade
