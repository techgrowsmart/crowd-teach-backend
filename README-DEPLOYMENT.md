# GoGrowSmart Backend Deployment Guide

## Current Status
- ❌ Backend at https://growsmartserver.gogrowsmart.com/ is not responding
- ✅ Backend code is ready for deployment
- ✅ Deployment scripts created

## EC2 Server Information
- **IP Address**: 16.171.57.134
- **Domain**: growsmartserver.gogrowsmart.com
- **SSH User**: ec2-user

## Deployment Architecture
```
Internet → Nginx (443) → Node.js Backend (3000)
```

## Quick Deployment Steps

### 1. First-time Server Setup (Run once on EC2)
```bash
# SSH into EC2
ssh -i your-key.pem ec2-user@16.171.57.134

# Download and run setup script
wget https://raw.githubusercontent.com/your-repo/ec2-setup.sh
chmod +x ec2-setup.sh
./ec2-setup.sh
```

### 2. SSL Certificate Setup
```bash
# On EC2 server, place your SSL certificates:
sudo mkdir -p /home/ec2-user/certs
# Copy your certificates:
# - fullchain.pem → /home/ec2-user/certs/fullchain.pem
# - privkey.pem → /home/ec2-user/certs/privkey.pem
sudo chown -R ec2-user:ec2-user /home/ec2-user/certs
```

### 3. Deploy Backend (Run from local machine)
```bash
# From your local backend directory:
./deploy.sh
```

### 4. Configure Nginx (On EC2)
```bash
# Copy nginx config
sudo cp /home/ec2-user/crowd-teach-gogrowsmart-backend/nginx.conf /etc/nginx/nginx.conf

# Test and restart nginx
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## Manual Deployment Commands

If scripts don't work, use these manual commands:

```bash
# 1. SSH into EC2
ssh -i your-key.pem ec2-user@16.171.57.134

# 2. Stop existing application
pm2 stop app.js || true
pm2 delete app.js || true

# 3. Backup current version
cp -r /home/ec2-user/crowd-teach-gogrowsmart-backend /home/ec2-user/backups/backend_$(date +%Y%m%d_%H%M%S)

# 4. Sync files (from local machine)
rsync -avz --exclude node_modules \
    --exclude .git \
    --exclude logs \
    --exclude uploads \
    ./ ec2-user@16.171.57.134:/home/ec2-user/crowd-teach-gogrowsmart-backend/

# 5. Install dependencies (on EC2)
cd /home/ec2-user/crowd-teach-gogrowsmart-backend
npm ci --production

# 6. Start application
pm2 start app.js --name backend
pm2 save
pm2 startup

# 7. Check status
pm2 status
pm2 logs backend
```

## Environment Configuration

The backend is configured to:
- Run on port 3000 internally
- Use HTTP (Nginx handles SSL termination)
- Connect to Cassandra database
- Connect to MongoDB
- Use S3 for file storage

## Verification Commands

```bash
# Check if backend is running
curl http://localhost:3000/api/ping

# Check PM2 status
pm2 status

# Check logs
pm2 logs backend

# Check nginx status
sudo systemctl status nginx

# Test external access
curl https://growsmartserver.gogrowsmart.com/api/ping
```

## Troubleshooting

### Backend not starting:
```bash
# Check logs
pm2 logs backend

# Check if port is in use
sudo netstat -tlnp | grep :3000

# Restart manually
pm2 restart backend
```

### SSL issues:
```bash
# Check certificate files
ls -la /home/ec2-user/certs/

# Test nginx config
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Database connection issues:
```bash
# Check environment variables
cat /home/ec2-user/crowd-teach-gogrowsmart-backend/.env

# Test database connectivity
node -e "require('./config/db.js')"
```

## Security Notes

- 🔒 SSL certificates should be renewed before expiration
- 🔥 Firewall allows only HTTP (80) and HTTPS (443)
- 🚀 Application runs as non-root user
- 📝 Logs are rotated automatically
- 🔄 PM2 handles automatic restarts

## Monitoring

Monitor your deployment with:
```bash
# PM2 monitoring
pm2 monit

# System resources
top
htop
df -h

# Application logs
tail -f /home/ec2-user/.pm2/logs/backend-out.log
tail -f /home/ec2-user/.pm2/logs/backend-error.log
```

## Next Steps After Deployment

1. ✅ Verify backend is accessible at https://growsmartserver.gogrowsmart.com/api/ping
2. ✅ Test all API endpoints
3. ✅ Check mobile app connectivity
4. ✅ Set up monitoring alerts
5. ✅ Configure backup strategy
