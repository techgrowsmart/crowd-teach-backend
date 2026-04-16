# 🖥️ Hostinger VPS Deployment Guide

## Quick Deploy (Console Commands)

### Option 1: Automated Script (Recommended)

```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
./deploy-vps.sh
```

You'll be prompted for VPS password, then everything deploys automatically.

### Option 2: Manual Step-by-Step

#### Step 1: Create Deployment Package
```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
tar -czf vps-deploy.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='uploads/*' \
    --exclude='*.tar.gz' \
    .
```

#### Step 2: Upload to VPS
```bash
scp vps-deploy.tar.gz u385735845@88.223.84.61:~/
```

#### Step 3: SSH into VPS
```bash
ssh u385735845@88.223.84.61
```

#### Step 4: Deploy on VPS (Run inside SSH)
```bash
cd ~
tar -xzf vps-deploy.tar.gz
mkdir -p growsmart-backend
cp -r * growsmart-backend/ 2>/dev/null || true
cd growsmart-backend

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo systemctl start docker
rm get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Deploy
docker-compose -f docker-compose.production.yml up -d --build

# Check status
curl http://localhost:3000/api/ping
```

---

## What's Deployed

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| Backend | growsmart-backend | 3000 | API + WebSocket |
| Redis | growsmart-redis | 6379 (internal) | Cache/Sessions |

---

## After Deployment

### Test API
```bash
curl http://88.223.84.61:3000/api/ping
```

### View Logs
```bash
ssh u385735845@88.223.84.61 'cd ~/growsmart-backend && docker-compose -f docker-compose.production.yml logs -f app'
```

### Restart
```bash
ssh u385735845@88.223.84.61 'cd ~/growsmart-backend && docker-compose -f docker-compose.production.yml restart'
```

### Stop
```bash
ssh u385735845@88.223.84.61 'cd ~/growsmart-backend && docker-compose -f docker-compose.production.yml down'
```

---

## URLs

| Service | URL |
|---------|-----|
| API | `http://88.223.84.61:3000` |
| WebSocket | `ws://88.223.84.61:3000` |
| Test | `http://88.223.84.61:3000/api/ping` |

---

## Update Frontend Config

After deployment, update your frontend to use the new VPS:

```javascript
// React Native / React config
const API_URL = 'http://88.223.84.61:3000';
const WS_URL = 'ws://88.223.84.61:3000';
```

Or for HTTPS (if you add SSL):
```javascript
const API_URL = 'https://api.gogrowsmart.com';
const WS_URL = 'wss://api.gogrowsmart.com';
```

---

## Troubleshooting

### Port 3000 Already in Use
```bash
# On VPS
sudo lsof -ti:3000 | xargs kill -9 2>/dev/null
```

### Docker Permission Denied
```bash
# On VPS
sudo usermod -aG docker $USER
# Logout and login again
```

### Redis Connection Failed
```bash
# On VPS
docker-compose -f docker-compose.production.yml restart redis
```

### Full Reset
```bash
# On VPS
cd ~/growsmart-backend
docker-compose -f docker-compose.production.yml down
docker system prune -f
docker-compose -f docker-compose.production.yml up -d --build
```

---

## Files Created

| File | Purpose |
|------|---------|
| `deploy-vps.sh` | Automated deployment script |
| `vps-deploy-commands.sh` | Step-by-step manual commands |
| `vps-deploy.tar.gz` | Deployment package (created by script) |

---

## Quick Commands Reference

```bash
# Deploy everything
./deploy-vps.sh

# Or manual:
scp vps-deploy.tar.gz u385735845@88.223.84.61:~/
ssh u385735845@88.223.84.61
cd ~/growsmart-backend
docker-compose -f docker-compose.production.yml up -d
```

🎉 **WebSocket is included!** No separate setup needed - it's built into the backend on port 3000.
