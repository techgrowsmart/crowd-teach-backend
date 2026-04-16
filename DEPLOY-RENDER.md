# 🎨 Deploy Backend to Render (Alternative to Railway)

## Quick Deploy (10 Minutes)

### Step 1: Sign Up
1. Go to https://render.com
2. Sign up with GitHub

### Step 2: Create Web Service
1. Dashboard → "New +" → "Web Service"
2. Connect GitHub repo OR upload code

### Step 3: Configure
```
Name: growsmart-backend
Environment: Docker
Dockerfile Path: ./Dockerfile.production
Branch: main
```

### Step 4: Add Environment Variables
Click "Advanced" → Add all from `.env.production` (same as Railway guide)

### Step 5: Add Redis
1. "New +" → "Redis"
2. Name: growsmart-redis
3. Copy internal URL
4. Add to env vars: `REDIS_URL=redis://...`

### Step 6: Deploy
Click "Create Web Service"
Render auto-deploys!

## Render Free Tier
- 750 hours/month
- Automatic deploys from Git
- SSL included
- Custom domains supported

## URLs After Deploy
- API: `https://growsmart-backend.onrender.com`
- WebSocket: `wss://growsmart-backend.onrender.com`

## Update Frontend Config
```javascript
const API_URL = 'https://growsmart-backend.onrender.com';
const WS_URL = 'wss://growsmart-backend.onrender.com';
```
