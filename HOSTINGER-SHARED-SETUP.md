# Hostinger Shared Hosting - Node.js Setup Guide

## What You Have Now
- **Website**: https://api.gogrowsmart.com
- **IP**: 88.223.84.61
- **File Upload Path**: public_html
- **FTP**: u385735845.api.gogrowsmart.com

## Critical Steps to Complete

### 1. Upload Missing Files

You need to upload these files to your `public_html` directory:

**Required Files:**
- `.htaccess` → Routes traffic to Node.js
- `passenger.js` → Tells Hostinger how to start Node.js
- `package.json` → Dependencies
- `app.js` → Your main app
- `.env` → Environment variables (create from .env.production)
- `secure-connect-gogrowsmart.zip` → Astra DB bundle
- All folders: `config/`, `routes/`, `middleware/`, `models/`, `utils/`, `services/`, `controllers/`

### 2. Set Up Node.js in Hostinger Panel

1. **Login to Hostinger Panel**: https://hpanel.hostinger.com
2. **Go to**: Advanced → Node.js
3. **Click**: "Create Application"
4. **Configure**:
   - **Node.js Version**: 20.x
   - **Application Root**: `public_html`
   - **Application URL**: `api.gogrowsmart.com`
   - **Application Startup File**: `passenger.js`
   - **Environment**: `production`
5. **Click**: Create

### 3. Install Dependencies

In Hostinger File Manager or via SSH:

```bash
cd ~/public_html
npm install --production
```

Or use Hostinger's "NPM Install" button in the Node.js section.

### 4. Create .env File

Create `/public_html/.env` with your production values:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Astra DB
ASTRA_DB_KEYSPACE=teachnteachprod
ASTRA_TOKEN=your_token_here
ASTRA_DB_USERNAME=your_username_here
ASTRA_DB_PASSWORD=your_password_here

# MongoDB
MONGO_DB_URL=mongodb+srv://...
MONGO_DB_DATABASE=GrowThoughts

# Redis (if available)
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET_KEY=your_jwt_secret

# Razorpay
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=your_secret

# Email
EMAIL_USER=contact@gogrowsmart.com
EMAIL_PASS=your_email_password
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=465

# AWS S3
AWS_REGION=eu-north-1
S3_BUCKET_NAME=crowdteach-app-s3
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret

# Firebase
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=go-grow-smart
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@go-grow-smart.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=...
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/...

LOG_REQUEST=true
```

### 5. Restart Node.js App

In Hostinger Panel:
1. Go to Advanced → Node.js
2. Find your app
3. Click **"Restart"**

### 6. Verify Deployment

Test these URLs:
```
https://api.gogrowsmart.com/
https://api.gogrowsmart.com/health
https://api.gogrowsmart.com/api/ping
```

## Troubleshooting

### App Won't Start
1. Check logs in Hostinger: Advanced → Node.js → "Logs"
2. Verify `passenger.js` exists in root
3. Check `.env` file has all required variables

### 502 Bad Gateway
- Node.js app crashed
- Check logs
- Ensure PORT=3000 in .env

### CORS Errors
- Already handled in `.htaccess`
- Also handled in `app.js`

### Database Connection Fails
- Verify `secure-connect-gogrowsmart.zip` is uploaded
- Check Astra credentials in .env

## Quick Checklist

- [ ] All backend files uploaded to public_html
- [ ] .htaccess file in public_html
- [ ] passenger.js file in public_html
- [ ] .env file created with all secrets
- [ ] secure-connect-gogrowsmart.zip uploaded
- [ ] Node.js app created in Hostinger panel
- [ ] npm install run
- [ ] App restarted
- [ ] Health endpoint returns 200

## FTP Upload Instructions

**FTP Details:**
- **Host**: ftp://88.223.84.61 or api.gogrowsmart.com
- **Username**: u385735845.api.gogrowsmart.com
- **Password**: Your Hostinger password
- **Port**: 21 (or 22 for SFTP)

**Upload Path**: `/public_html/`

## Alternative: Use File Manager

1. Go to hpanel.hostinger.com
2. Files → File Manager
3. Navigate to `public_html`
4. Upload files using the upload button

## Support

If issues persist:
1. Check Hostinger logs: Advanced → Node.js → Logs
2. Contact Hostinger support with error messages
3. Verify all environment variables are correct
