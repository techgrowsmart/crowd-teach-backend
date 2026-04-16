# 🚂 Deploy Backend to Railway (No SSH/EC2 Needed)

## Quick Deploy (5 Minutes)

### Step 1: Sign Up
1. Go to https://railway.app
2. Click "Get Started" → Sign up with GitHub
3. Verify email

### Step 2: Create Project
1. Click "New Project"
2. Select "Empty Project"
3. Click "New" → "Service" → "+ Add Service"

### Step 3: Deploy Backend
**Option A: Upload Files**
1. Click "New" → "Service" → "Upload Code"
2. Select `backend-railway-ready.tar.gz` (2.4MB file I created)
3. Railway auto-detects Dockerfile

**Option B: GitHub Repo**
1. Connect your GitHub repo
2. Select the backend folder

### Step 4: Add Environment Variables
Click on your service → "Variables" tab → Add these from `.env.production`:

```
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
ASTRA_DB_KEYSPACE=teachnteachprod
ASTRA_TOKEN=AstraCS:WFCCWTsvnwDBMSsshKSDODfK:425c9e7bd2f0df484c4f3f9eaca081d15cef35a4ae0f3181cac14a7c05898167
ASTRA_DB_USERNAME=WFCCWTsvnwDBMSsshKSDODfK
ASTRA_DB_PASSWORD=k41+WoE35KtZ-rANAKRh10WK_iff_AiKUvGgTtcc_Giy88lgns.nthYD6PyjCENb3eawnG8y5QAxs8DpZntw_,hdlHgF99Q,AKgDFkpQv,KpGut-,FB0n2-39s26EO5a
MONGO_DB_URL=mongodb+srv://techgrowsmart_db_user:sSWXjJjegYXFAkJO@growthoughts.vwc6tf9.mongodb.net/GrowThoughts?retryWrites=true&w=majority&appName=GrowThoughts
MONGO_DB_DATABASE=GrowThoughts
JWT_SECRET_KEY=someVeryStrongRandomSecretKey
RAZORPAY_KEY_ID=rzp_test_RY9WNGFa44XzaQ
RAZORPAY_KEY_SECRET=9gEMohtoJOUi142wojiP0s8g
RAZORPAY_DEV_ROUTE_ACCOUNTS=true
EMAIL_USER=contact@gogrowsmart.com
EMAIL_PASS=Matul2002*
EMAIL_PORT=465
EMAIL_HOST=smtp.hostinger.com
AWS_REGION=eu-north-1
S3_BUCKET_NAME=crowdteach-app-s3
AWS_ACCESS_KEY_ID=AKIAWG6DG5B65KSECRO4
AWS_SECRET_ACCESS_KEY=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
LOG_REQUEST=true
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=go-grow-smart
FIREBASE_PRIVATE_KEY_ID=2cc45e2bc38fbc03456ec742d4fd378255542396
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@go-grow-smart.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=117053154089622042415
```

### Step 5: Add Redis
1. Click "New" → "Database" → "Add Redis"
2. Railway creates Redis automatically
3. Copy Redis URL from "Connect" tab
4. Add to variables: `REDIS_URL=${{Redis.REDIS_URL}}`

### Step 6: Deploy
1. Railway auto-deploys when you add variables
2. Wait 2-3 minutes for build
3. Click "Deploy Logs" to see progress

### Step 7: Get Public URL
1. Go to "Settings" tab
2. Click "Generate Domain"
3. Copy your URL: `https://your-app.up.railway.app`

### Step 8: Update Frontend
Change your frontend API URL to the new Railway URL:
```javascript
// In your React Native / React app
const API_URL = 'https://your-app.up.railway.app';
const WS_URL = 'wss://your-app.up.railway.app';  // WebSocket
```

## Railway WebSocket Support

✅ WebSocket works automatically on Railway
✅ No separate port needed
✅ SSL included (wss://)
✅ Same URL for API and WebSocket

## Domain Mapping (Optional)

To use `api.gogrowsmart.com`:
1. Railway Settings → "Custom Domain"
2. Add `api.gogrowsmart.com`
3. Add CNAME in Hostinger DNS:
   - Name: `api`
   - Value: `your-app.up.railway.app`

## Verify Deployment

```bash
# Test API
curl https://your-app.up.railway.app/api/ping

# Test WebSocket (install wscat)
npm install -g wscat
wscat -c wss://your-app.up.railway.app
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails | Check Dockerfile.production exists |
| Redis error | Ensure Redis service is added |
| CORS error | Add Railway URL to socket.js origins |
| WebSocket fails | Use `wss://` not `ws://` |

## Free Tier Limits

- 500 hours/month (enough for 1 service)
- 1GB RAM
- 1GB disk
- Perfect for production!

## Ready Package

File `backend-railway-ready.tar.gz` (2.4MB) is ready to upload!
