#!/bin/bash
# FAST EC2 DEPLOYMENT - Run this ON the EC2 instance
set -e

echo "🚀 FAST EC2 DEPLOYMENT"
echo "======================"

# 1. Install Docker if needed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    sudo yum update -y
    sudo yum install -y docker
    sudo service docker start
    sudo usermod -aG docker $USER
    echo "✅ Docker installed (re-login may be needed)"
fi

# 2. Install docker-compose if needed
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ docker-compose installed"
fi

# 3. Ensure Docker is running
sudo service docker start

# 4. Clone repo if not exists, or use existing
BACKEND_DIR="$HOME/gogrowsmart-backend"
if [ ! -d "$BACKEND_DIR" ]; then
    echo "📂 Cloning repo..."
    git clone https://github.com/yourusername/crowd-teach-gogrowsmart-backend.git "$BACKEND_DIR" 2>/dev/null || {
        echo "⚠️  Could not clone. Please manually upload code to $BACKEND_DIR"
        mkdir -p "$BACKEND_DIR"
    }
fi

cd "$BACKEND_DIR"

# 5. Create mongo-init.js
cat > mongo-init.js << 'EOF'
db = db.getSiblingDB('gogrowsmart');
if (!db.getCollectionNames().includes('posts')) db.createCollection('posts');
if (!db.getCollectionNames().includes('post_likes')) db.createCollection('post_likes');
if (!db.getCollectionNames().includes('comments')) db.createCollection('comments');
if (!db.getCollectionNames().includes('teacher_bank_details')) db.createCollection('teacher_bank_details');
db.posts.createIndex({ "createdAt": -1 });
db.posts.createIndex({ "teacherEmail": 1 });
db.post_likes.createIndex({ "postId": 1, "userEmail": 1 }, { unique: true });
db.comments.createIndex({ "postId": 1 });
print('MongoDB initialized');
EOF

# 6. Create directories
mkdir -p uploads logs certs

# 7. Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker stop $(docker ps -q) 2>/dev/null || true

# 8. Deploy
echo "🚀 Starting deployment..."
docker-compose -f docker-compose.production.yml up -d --build

# 9. Wait and check
echo "⏳ Waiting 30s for startup..."
sleep 30

echo ""
echo "📊 Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "🧪 Testing API..."
curl -s http://localhost:3000/health || curl -s http://localhost:3000/api/ping || echo "API still starting..."

echo ""
echo "========================================"
echo "✅ DEPLOYMENT COMPLETE!"
echo "========================================"
echo "API:       http://$(curl -s ifconfig.me):3000"
echo "Logs:      docker-compose -f docker-compose.production.yml logs -f"
echo ""
