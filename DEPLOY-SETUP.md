# Backend Auto-Deployment Setup for api.gogrowsmart.com

This guide sets up automatic deployment of the backend to `api.gogrowsmart.com` on Hostinger VPS.

## What Happens on Push

1. GitHub Actions triggers on push to `main` branch
2. Creates a production package with all required files
3. Generates `.env` file from GitHub secrets
4. Deploys via SSH to `/home/u385735845/api.gogrowsmart.com`
5. Installs dependencies and restarts PM2 process
6. Performs health check

## Required GitHub Secrets

Go to **GitHub Repo → Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

### VPS Connection
| Secret Name | Value | Where to find |
|-------------|-------|---------------|
| `BACKEND_VPS_HOST` | `88.223.84.61` | Your Hostinger VPS IP |
| `BACKEND_VPS_USER` | `u385735845` | Hostinger SSH username |
| `BACKEND_VPS_PASSWORD` | Your SSH password | Hostinger Panel → Advanced → SSH Access |
| `BACKEND_VPS_PORT` | `65002` | Hostinger SSH port |

### Database (Astra DB)
| Secret Name | Value |
|-------------|-------|
| `ASTRA_DB_KEYSPACE` | `teachnteachprod` |
| `ASTRA_TOKEN` | Your Astra token |
| `ASTRA_DB_USERNAME` | Your Astra username |
| `ASTRA_DB_PASSWORD` | Your Astra password |

### MongoDB
| Secret Name | Value |
|-------------|-------|
| `MONGO_DB_URL` | Your MongoDB connection string |
| `MONGO_DB_DATABASE` | `GrowThoughts` |

### Redis
| Secret Name | Value |
|-------------|-------|
| `REDIS_URL` | `redis://localhost:6379` or your Redis URL |

### JWT
| Secret Name | Value |
|-------------|-------|
| `JWT_SECRET_KEY` | Your JWT secret |

### Razorpay
| Secret Name | Value |
|-------------|-------|
| `RAZORPAY_KEY_ID` | Your Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Your Razorpay secret |

### Email (Hostinger SMTP)
| Secret Name | Value |
|-------------|-------|
| `EMAIL_USER` | `contact@gogrowsmart.com` |
| `EMAIL_PASS` | Your email password |
| `EMAIL_HOST` | `smtp.hostinger.com` |
| `EMAIL_PORT` | `465` |

### AWS S3
| Secret Name | Value |
|-------------|-------|
| `AWS_REGION` | `eu-north-1` |
| `S3_BUCKET_NAME` | `crowdteach-app-s3` |
| `AWS_ACCESS_KEY_ID` | Your AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Your AWS secret key |

### Firebase
| Secret Name | Value |
|-------------|-------|
| `FIREBASE_PROJECT_ID` | `go-grow-smart` |
| `FIREBASE_PRIVATE_KEY_ID` | Your private key ID |
| `FIREBASE_PRIVATE_KEY` | Your private key (full key with newlines) |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk-xxx@go-grow-smart.iam.gserviceaccount.com` |
| `FIREBASE_CLIENT_ID` | Your client ID |

## One-Time VPS Setup

SSH into your VPS once to set up the initial environment:

```bash
# SSH into VPS
ssh -p 65002 u385735845@88.223.84.61

# Install Node.js 20 if not installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Create app directory
mkdir -p ~/api.gogrowsmart.com

# Setup PM2 startup
pm2 startup systemd
```

## Manual Deploy

If you need to deploy manually:

```bash
# Go to Actions tab in GitHub repo
# Click "Backend Deploy to api.gogrowsmart.com"
# Click "Run workflow"
```

## Verify Deployment

After deployment, check:

```bash
# SSH into VPS
ssh -p 65002 u385735845@88.223.84.61

# Check PM2 status
pm2 status
pm2 logs api-backend

# Test API
curl http://88.223.84.61:3000/health
curl http://88.223.84.61:3000/
```

## Troubleshooting

### Check logs
```bash
pm2 logs api-backend
```

### Restart manually
```bash
pm2 restart api-backend
```

### Environment variables not updating
```bash
cd ~/api.gogrowsmart.com
pm2 delete api-backend
pm2 start app.js --name api-backend --env production
pm2 save
```

## DNS Setup

Point `api.gogrowsmart.com` to your VPS:

1. Go to Hostinger DNS Zone Editor
2. Add A record:
   - **Name**: `api`
   - **Type**: `A`
   - **Points to**: `88.223.84.61`
   - **TTL**: `14400`

Wait 5-10 minutes for DNS propagation.

## API Endpoints

Once deployed:

- **Health Check**: `http://api.gogrowsmart.com:3000/health`
- **Root**: `http://api.gogrowsmart.com:3000/`
- **API Base**: `http://api.gogrowsmart.com:3000/api/`
