# 🚀 EC2 Deployment - Alternative Methods

Since SSH direct connection failed, here are 3 ways to deploy:

## Method 1: AWS Systems Manager (Session Manager) - RECOMMENDED

If your EC2 has SSM agent installed, connect without SSH key:

```bash
# Install AWS CLI first if not installed
aws configure  # Enter your AWS credentials

# Connect via Session Manager
aws ssm start-session --target i-xxxxxxxxxxxxxxxxx

# Once connected, run:
cd ~
curl -O https://your-hostinger-domain.com/ec2-deployment-package.tar.gz
tar -xzf ec2-deployment-package.tar.gz
cd crowd-teach-gogrowsmart-backend
./deploy-manual-ec2.sh
```

## Method 2: Upload via Hostinger → Download on EC2

Upload the deployment package to Hostinger, then download on EC2:

```bash
# On EC2 (use AWS console to get shell access)
cd ~
# Download from where you uploaded
wget https://portal.gogrowsmart.com/ec2-deployment-package.tar.gz
tar -xzf ec2-deployment-package.tar.gz
cd crowd-teach-gogrowsmart-backend
./deploy-manual-ec2.sh
```

## Method 3: AWS Console Connect

1. Go to AWS Console → EC2 → Instances
2. Select your instance (growsmartserver)
3. Click "Connect" → "EC2 serial console" or "Session Manager"
4. Once in shell:

```bash
# Install git and clone
git clone https://github.com/your-repo/crowd-teach-gogrowsmart-backend.git
cd crowd-teach-gogrowsmart-backend

# Or if you uploaded the tar file:
cd ~
tar -xzf ec2-deployment-package.tar.gz

# Deploy
./deploy-manual-ec2.sh
```

## Quick Commands for EC2 (Once Connected)

```bash
# Navigate to backend directory
cd ~/crowd-teach-gogrowsmart-backend

# Deploy everything
./deploy-manual-ec2.sh

# Check status
docker-compose -f docker-compose.production.yml ps

# View logs
docker-compose -f docker-compose.production.yml logs -f app

# Test API
curl http://localhost:3000/api/ping

# Check Redis
docker-compose -f docker-compose.production.yml exec redis redis-cli ping
```

## Files Ready for Deployment

Package created: `ec2-deployment-package.tar.gz` (1.2MB)

Contains:
- ✅ All backend code
- ✅ docker-compose.production.yml
- ✅ Dockerfile.production
- ✅ .env.production
- ✅ deploy-manual-ec2.sh
- ✅ socket.js (WebSocket configured)
- ✅ app.js (CORS configured)

## Fixing SSH Access

To enable direct SSH in future, check on AWS Console:

1. **EC2 Instance State**: Must be "running"
2. **Security Group**: Must allow inbound port 22 (SSH) from your IP
3. **Key Pair**: Must match the .pem file you're using
4. **User**: Try `ec2-user` (Amazon Linux) or `ubuntu` (Ubuntu)

### Fix Security Group:
```
AWS Console → EC2 → Security Groups → Select your SG
→ Inbound rules → Edit → Add rule:
  Type: SSH
  Protocol: TCP
  Port: 22
  Source: My IP (or 0.0.0.0/0 for any - not recommended)
```

## WebSocket Configuration Reminder

WebSocket runs on **SAME PORT** as API:
- Internal: `ws://localhost:3000`
- Production: `wss://growsmartserver.gogrowsmart.com`

No separate port needed!

## Troubleshooting EC2 Connection

### "Connection refused"
- EC2 might be stopped → Start it in AWS Console
- Security group blocking → Add port 22 inbound rule

### "Permission denied"
- Wrong key file → Check AWS Console which key pair is assigned
- Key permissions → Run: `chmod 600 your-key.pem`

### "No route to host"
- Check instance has public IP assigned
- Check VPC/Subnet routing

## After Deployment

Once deployed, the backend will be available at:
- `http://growsmartserver.gogrowsmart.com:3000`

Setup SSL with:
```bash
sudo certbot certonly --standalone -d growsmartserver.gogrowsmart.com
```

Or use AWS Application Load Balancer with ACM certificate.
