# Docker Production Deployment
# This will containerize your backend with all dependencies

# 1. Build and start containers
docker-compose -f docker-compose.prod.yml up --build -d

# 2. View logs
docker-compose -f docker-compose.prod.yml logs -f backend

# 3. Stop containers
docker-compose -f docker-compose.prod.yml down

# 4. Update code
docker-compose -f docker-compose.prod.yml down
git pull origin main
docker-compose -f docker-compose.prod.yml up --build -d

# Environment variables needed:
# Create .env.prod file with all variables from .env file

# Certificate setup:
# mkdir -p certs
# Copy your SSL certificates to certs/ folder
# cp /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/fullchain.pem certs/
# cp /etc/letsencrypt/live/growsmartserver.gogrowsmart.com/privkey.pem certs/

# Health check:
# curl https://growsmartserver.gogrowsmart.com/api/ping
