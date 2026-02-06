# 🚀 Manual Deployment to EC2 Server

## Current Status
❌ **Latest changes are NOT deployed** on https://growsmartserver.gogrowsmart.com
- `/api/posts/all` → 404 (should exist)
- `/api/posts/create` → 404 (should exist)
- `/api/teacherProfile` → 401 (exists, needs auth)

## Step-by-Step Deployment Commands

### 1. Connect to EC2 Server
```bash
# Replace with your actual SSH key path if different
ssh -i ~/.ssh/your-key.pem ec2-user@growsmartserver.gogrowsmart.com
```

### 2. Navigate to Backend Directory
```bash
# Try these paths (use the one that exists):
cd crowd-teach-gogrowsmart-backend
# OR
cd /home/ec2-user/crowd-teach-gogrowsmart-backend
# OR
cd /var/www/crowd-teach-gogrowsmart-backend
```

### 3. Check Current Status
```bash
git status
git log --oneline -n 3
```

### 4. Pull Latest Changes
```bash
git pull origin main
```

### 5. Install Dependencies
```bash
npm install
```

### 6. Check Running Processes
```bash
pm2 status
# OR
ps aux | grep node
# OR
docker-compose ps
```

### 7. Restart Application
```bash
# Option 1: Using PM2 (most common)
pm2 restart app.js

# Option 2: Using Docker Compose
docker-compose down
docker-compose up -d --build

# Option 3: Direct Node.js
pkill -f "node.*app.js"
nohup node app.js > app.log 2>&1 &
```

### 8. Verify Deployment
```bash
# Wait 10 seconds
sleep 10

# Check if running
pm2 status
# OR
ps aux | grep "node.*app.js"

# Check logs
pm2 logs app.js --lines 20
# OR
tail -20 app.log
```

## After Deployment - Verification

From your local machine, run:
```bash
# Test posts endpoint
curl -s -o /dev/null -w "Status: %{http_code}\n" https://growsmartserver.gogrowsmart.com/api/posts/all

# Test teacher profile endpoint
curl -s -o /dev/null -w "Status: %{http_code}\n" -X POST https://growsmartserver.gogrowsmart.com/api/teacherProfile -H "Content-Type: application/json" -d '{}'
```

## Expected Results After Successful Deployment:
- `/api/posts/all` → **200** (or 401 if auth required, but NOT 404)
- `/api/posts/create` → **200** (or 401 if auth required, but NOT 404)
- `/api/teacherProfile` → **401** (expected - needs authentication)

## Troubleshooting

### If SSH fails:
- Check your SSH key: `ssh-add -l`
- Try with explicit key: `ssh -i /path/to/key.pem ec2-user@server`

### If git pull fails:
```bash
git remote -v
git remote set-url origin https://github.com/Scoder6/crowd-teach-gogrowsmart-backend.git
git pull origin main
```

### If PM2 not found:
```bash
npm install -g pm2
pm2 start app.js
```

### If port issues:
```bash
# Check what's running on port 443
sudo netstat -tlnp | grep :443
# Kill process if needed
sudo kill -9 <PID>
```

## Quick One-Liner (Copy & Paste)
```bash
ssh -i ~/.ssh/your-key.pem ec2-user@growsmartserver.gogrowsmart.com "cd crowd-teach-gogrowsmart-backend && git pull origin main && npm install && pm2 restart app.js"
```

Replace `~/.ssh/your-key.pem` with your actual SSH key path.
