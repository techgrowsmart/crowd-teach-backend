#!/bin/bash
# Setup script for GitHub Secrets - Backend Deployment
# Run this to get the GitHub CLI commands to add all secrets

echo "================================================"
echo "GitHub Secrets Setup for Backend Deployment"
echo "================================================"
echo ""
echo "Prerequisites:"
echo "1. Install GitHub CLI: gh (https://cli.github.com/)"
echo "2. Login: gh auth login"
echo "3. Run this from the repo root"
echo ""
echo "================================================"
echo ""
echo "Copy and run these commands to add secrets:"
echo ""

# VPS Connection
echo "# VPS Connection Secrets"
echo "gh secret set BACKEND_VPS_HOST -b\"88.223.84.61\""
echo "gh secret set BACKEND_VPS_USER -b\"u385735845\""
echo "gh secret set BACKEND_VPS_PASSWORD -b\"YOUR_SSH_PASSWORD_HERE\"  # Get from Hostinger Panel"
echo "gh secret set BACKEND_VPS_PORT -b\"65002\""
echo ""

# Astra DB
echo "# Astra DB (from .env.production)"
echo "gh secret set ASTRA_DB_KEYSPACE -b\"teachnteachprod\""
echo "gh secret set ASTRA_TOKEN -b\"AstraCS:WFCCWTsvnwDBMSsshKSDODfK:425c9e7bd2f0df484c4f3f9eaca081d15cef35a4ae0f3181cac14a7c05898167\""
echo "gh secret set ASTRA_DB_USERNAME -b\"WFCCWTsvnwDBMSsshKSDODfK\""
echo "gh secret set ASTRA_DB_PASSWORD -b\"k41+WoE35KtZ-rANAKRh10WK_iff_AiKUvGgTtcc_Giy88lgns.nthYD6PyjCENb3eawnG8y5QAxs8DpZntw_,hdlHgF99Q,AKgDFkpQv,KpGut-,FB0n2-39s26EO5a\""
echo ""

# MongoDB
echo "# MongoDB (from .env.production)"
echo "gh secret set MONGO_DB_URL -b\"mongodb+srv://techgrowsmart_db_user:sSWXjJjegYXFAkJO@growthoughts.vwc6tf9.mongodb.net/GrowThoughts?retryWrites=true&w=majority&appName=GrowThoughts\""
echo "gh secret set MONGO_DB_DATABASE -b\"GrowThoughts\""
echo ""

# Redis
echo "# Redis (update if you have a Redis instance)"
echo "gh secret set REDIS_URL -b\"redis://localhost:6379\""
echo ""

# JWT
echo "# JWT Secret (generate a new secure one for production)"
echo "gh secret set JWT_SECRET_KEY -b\"$(openssl rand -base64 32)\""
echo ""

# Razorpay
echo "# Razorpay (from .env.production)"
echo "gh secret set RAZORPAY_KEY_ID -b\"rzp_test_RY9WNGFa44XzaQ\""
echo "gh secret set RAZORPAY_KEY_SECRET -b\"9gEMohtoJOUi142wojiP0s8g\""
echo ""

# Email
echo "# Email (Hostinger SMTP from .env.production)"
echo "gh secret set EMAIL_USER -b\"contact@gogrowsmart.com\""
echo "gh secret set EMAIL_PASS -b\"Matul2002*\""
echo "gh secret set EMAIL_HOST -b\"smtp.hostinger.com\""
echo "gh secret set EMAIL_PORT -b\"465\""
echo ""

# AWS S3
echo "# AWS S3 (from .env.production)"
echo "gh secret set AWS_REGION -b\"eu-north-1\""
echo "gh secret set S3_BUCKET_NAME -b\"crowdteach-app-s3\""
echo "gh secret set AWS_ACCESS_KEY_ID -b\"AKIAWG6DG5B65KSECRO4\""
echo "gh secret set AWS_SECRET_ACCESS_KEY -b\"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\""
echo ""

# Firebase
echo "# Firebase (from .env.production - you'll need to add the private key)"
echo "gh secret set FIREBASE_PROJECT_ID -b\"go-grow-smart\""
echo "gh secret set FIREBASE_PRIVATE_KEY_ID -b\"2cc45e2bc38fbc03456ec742d4fd378255542396\""
echo "gh secret set FIREBASE_CLIENT_EMAIL -b\"firebase-adminsdk-fbsvc@go-grow-smart.iam.gserviceaccount.com\""
echo "gh secret set FIREBASE_CLIENT_ID -b\"117053154089622042415\""
echo ""
echo "⚠️  IMPORTANT: You need to manually add FIREBASE_PRIVATE_KEY"
echo "   Get it from Firebase Console → Project Settings → Service Accounts"
echo "   The private key is multi-line, so use:"
echo "   gh secret set FIREBASE_PRIVATE_KEY --body \"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n\""
echo ""

echo "================================================"
echo "Alternative: Add secrets via GitHub UI"
echo "================================================"
echo "Go to: https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions"
echo ""
echo "================================================"
echo "After adding secrets, trigger deployment:"
echo "================================================"
echo "1. Push any change to main branch, OR"
echo "2. Go to Actions → Backend Deploy → Run workflow"
echo ""
