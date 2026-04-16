#!/bin/bash
# Run this directly ON EC2 where code exists
set -e

DIR="${1:-./crowd-teach-gogrowsmart-backend}"
cd "$DIR" 2>/dev/null || cd ~/crowd-teach-gogrowsmart-backend 2>/dev/null || {
    echo "❌ Backend directory not found"
    echo "Usage: ./deploy-on-ec2.sh /path/to/backend"
    exit 1
}

echo "🚀 Deploying from: $(pwd)"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    sudo yum update -y && sudo yum install -y docker
    sudo service docker start
    sudo usermod -aG docker $USER
fi

if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing docker-compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

sudo service docker start

# Ensure mongo-init.js exists
if [ ! -f mongo-init.js ]; then
    cat > mongo-init.js << 'EOF'
db = db.getSiblingDB('gogrowsmart');
['posts','post_likes','comments','teacher_bank_details'].forEach(c => {
    if (!db.getCollectionNames().includes(c)) db.createCollection(c);
});
db.posts.createIndex({ "createdAt": -1 });
db.posts.createIndex({ "teacherEmail": 1 });
db.post_likes.createIndex({ "postId": 1, "userEmail": 1 }, { unique: true });
db.comments.createIndex({ "postId": 1 });
EOF
fi

mkdir -p uploads logs certs

# Stop and restart
docker-compose -f docker-compose.production.yml down 2>/dev/null || true
docker system prune -f 2>/dev/null || true

echo "🐳 Building and starting..."
docker-compose -f docker-compose.production.yml up -d --build

echo "⏳ Waiting 25s..."
sleep 25

echo ""
docker ps --format "table {{.Names}}\t{{.Status}}"
echo ""
curl -s http://localhost:3000/health 2>/dev/null && echo "✅ API Healthy" || echo "⏳ API still starting..."
echo ""
echo "🌐 Public URL: http://$(curl -s ifconfig.me):3000"
