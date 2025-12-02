# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# Copy only package files first for better caching
COPY package*.json ./

# Install only production dependencies, remove build deps afterwards
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps \
    && npm cache clean --force

# Copy app source (with .dockerignore to avoid dev files, logs, etc.)
COPY . .

# ===== Stage 2: Runtime =====
FROM node:20-alpine

WORKDIR /app

# Install pm2 globally (production only, no cache)
RUN npm install -g pm2 --omit=dev && npm cache clean --force

# Copy compiled/built app from builder
COPY --from=builder /app ./

RUN npm prune --production

# Fix permissions so 'node' user can write
RUN chown -R node:node /app

# Switch to the already-existing non-root node user
USER node

# Default command to start with pm2
CMD ["pm2-runtime", "app.js"]
