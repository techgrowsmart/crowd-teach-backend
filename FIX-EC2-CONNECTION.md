# 🔧 FIX EC2 Connection Issue

## Problem Diagnosed
```
IP: 3.95.195.41 (growsmartserver.gogrowsmart.com)
Status: NOT RESPONDING (timeout)
Ping: Failed
SSH: Connection timeout
```

## Quick Fix Steps (AWS Console)

### Step 1: Check EC2 Instance Status
1. Go to https://console.aws.amazon.com/ec2/
2. Click "Instances" in left menu
3. Find your instance (should show IP 3.95.195.41)
4. Check "Instance state" column
   - ✅ Should say "Running"
   - ❌ If "Stopped" → Select instance → "Instance state" → "Start instance"

### Step 2: Check Security Group
1. In EC2 Console, click on your instance
2. Look at "Security" tab → "Security groups"
3. Click the security group name
4. Check "Inbound rules"

**MUST HAVE these rules:**
```
Type      Protocol  Port Range  Source
SSH       TCP       22          0.0.0.0/0 (or your IP)
HTTP      TCP       80          0.0.0.0/0
HTTPS     TCP       443         0.0.0.0/0
Custom    TCP       3000        0.0.0.0/0 (for your API)
```

If missing, click "Edit inbound rules" → "Add rule"

### Step 3: Check Public IP
1. In instance details, look for "Public IPv4 address"
2. Should show: 3.95.195.41
3. If no public IP, you need to:
   - Attach an Elastic IP, OR
   - Restart instance (will get new IP), OR
   - Check VPC settings

### Step 4: Check Network ACL (if in VPC)
1. Go to VPC Console → Network ACLs
2. Find the one attached to your subnet
3. Ensure inbound/outbound allow traffic on port 22

## After Fixes, Test Again

```bash
# Test ping
ping 3.95.195.41

# Test SSH (will be fast now)
ssh -i gogrowsmart-key.pem ec2-user@growsmartserver.gogrowsmart.com
```

## Alternative: Use AWS Systems Manager

If you can't fix SSH, use Session Manager (doesn't need SSH):

1. AWS Console → EC2 → Your instance
2. Click "Connect" button (top right)
3. Select "Session Manager" tab
4. Click "Connect"

You'll get a browser-based shell!

## Once Connected via Session Manager

```bash
# Update system
sudo yum update -y  # Amazon Linux
# OR
sudo apt update && sudo apt upgrade -y  # Ubuntu

# Install Docker if not installed
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Logout and login again, then:
cd ~
# Upload the deployment package here via S3 or other method
# Then run:
./deploy-manual-ec2.sh
```

## Emergency: Create New Key Pair

If the key file is wrong:

1. EC2 Console → Network & Security → Key Pairs
2. Click "Create key pair"
3. Name: growsmart-new-key
4. Download the .pem file
5. Replace your local key file
6. Update instance to use new key (requires stop/start)

## Check These NOW

- [ ] Instance is "Running" (not stopped)
- [ ] Security group allows port 22
- [ ] Instance has Public IP (3.95.195.41)
- [ ] Using correct key file
- [ ] Key file has chmod 600 permissions

## After Fixed

Run this to deploy:
```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
./deploy-to-ec2.sh
```

Or manual method:
```bash
# On EC2
cd ~/crowd-teach-gogrowsmart-backend
./deploy-manual-ec2.sh
```
