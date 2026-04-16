# Railway Deploy - 5 Minutes, Free, Works 24/7

## Step 1: Push Code to GitHub

```bash
cd /Users/matul/Desktop/Work/crowd-teach-gogrowsmart-backend
git add .
git commit -m "ready for deploy"
git push origin main
```

## Step 2: Deploy on Railway

1. Go to **https://railway.app**
2. Click **"Login"** → Login with **GitHub**
3. Click **"New Project"**
4. Click **"Deploy from GitHub repo"**
5. Select your repository (crowd-teach-gogrowsmart-backend)
6. Click **"Add Variables"**
7. Add ALL these from your `.env.production` file:

```
NODE_ENV=production
ASTRA_DB_KEYSPACE=teachnteachprod
ASTRA_TOKEN=AstraCS:WFCCWTsvnwDBMSsshKSDODfK:425c9e7bd2f0df484c4f3f9eaca081d15cef35a4ae0f3181cac14a7c05898167
ASTRA_DB_USERNAME=WFCCWTsvnwDBMSsshKSDODfK
ASTRA_DB_PASSWORD=k41+WoE35KtZ-rANAKRh10WK_iff_AiKUvGgTtcc_Giy88lgns.nthYD6PyjCENb3eawnG8y5QAxs8DpZntw_,hdlHgF99Q,AKgDFkpQv,KpGut-,FB0n2-39s26EO5a
MONGO_DB_URL=mongodb+srv://techgrowsmart_db_user:sSWXjJjegYXFAkJO@growthoughts.vwc6tf9.mongodb.net/GrowThoughts?retryWrites=true&w=majority&appName=GrowThoughts
MONGO_DB_DATABASE=GrowThoughts
JWT_SECRET_KEY=your_secret_here
RAZORPAY_KEY_ID=rzp_test_RY9WNGFa44XzaQ
RAZORPAY_KEY_SECRET=9gEMohtoJOUi142wojiP0s8g
EMAIL_USER=contact@gogrowsmart.com
EMAIL_PASS=Matul2002*
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=465
AWS_REGION=eu-north-1
S3_BUCKET_NAME=crowdteach-app-s3
AWS_ACCESS_KEY_ID=AKIAWG6DG5B65KSECRO4
AWS_SECRET_ACCESS_KEY=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
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=go-grow-smart
FIREBASE_PRIVATE_KEY_ID=2cc45e2bc38fbc03456ec742d4fd378255542396
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@go-grow-smart.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=117053154089622042415
```

8. Click **"Deploy"**

## Step 3: Get Your URL

- Railway gives you a URL like: `https://crowd-teach-production.up.railway.app`
- Copy this URL - this is your new API endpoint

## Step 4: Test It

```bash
curl https://your-app-url.railway.app/health
```

## Step 5: Connect to Your Domain (Optional)

1. In Railway, click **Settings** → **Domains**
2. Click **"Generate Domain"** or add custom domain
3. In Hostinger DNS, add CNAME:
   - Name: `api`
   - Value: `your-app-url.railway.app`

## Done!

Your backend is live, free, and runs 24/7.

## Update Your Frontend

Change your frontend API URL to the Railway URL.
