/**
 * Redis Caching Middleware
 * Improves response times by caching frequently accessed data
 */

const redis = require('../config/redis');

class CacheMiddleware {
  constructor() {
    this.defaultTTL = 300; // 5 minutes
    this.userCacheTTL = 600; // 10 minutes
    this.publicCacheTTL = 60; // 1 minute
  }

  // Generic cache middleware
  cache(keyPrefix, ttl = this.defaultTTL) {
    return async (req, res, next) => {
      try {
        // Generate cache key
        const cacheKey = this.generateCacheKey(keyPrefix, req);
        
        // Try to get from cache
        const cachedData = await redis.get(cacheKey);
        
        if (cachedData) {
          console.log(`🎯 Cache HIT for: ${cacheKey}`);
          res.set('X-Cache', 'HIT');
          return res.json(JSON.parse(cachedData));
        }
        
        console.log(`💾 Cache MISS for: ${cacheKey}`);
        res.set('X-Cache', 'MISS');
        
        // Override res.json to cache the response
        const originalJson = res.json;
        res.json = function(data) {
          // Only cache successful responses
          if (res.statusCode === 200) {
            redis.setex(cacheKey, ttl, JSON.stringify(data)).catch(err => {
              console.error('❌ Cache set error:', err);
            });
          }
          return originalJson.call(this, data);
        };
        
        next();
      } catch (error) {
        console.error('❌ Cache middleware error:', error);
        next(); // Continue without caching if Redis fails
      }
    };
  }

  // Cache user-specific data
  cacheUser(ttl = this.userCacheTTL) {
    return async (req, res, next) => {
      if (!req.user || !req.user.email) {
        return next();
      }
      
      const cacheKey = `user:${req.user.email}:${req.originalUrl}`;
      
      try {
        const cachedData = await redis.get(cacheKey);
        
        if (cachedData) {
          console.log(`👤 User Cache HIT: ${cacheKey}`);
          res.set('X-Cache', 'HIT');
          return res.json(JSON.parse(cachedData));
        }
        
        console.log(`👤 User Cache MISS: ${cacheKey}`);
        res.set('X-Cache', 'MISS');
        
        const originalJson = res.json;
        res.json = function(data) {
          if (res.statusCode === 200) {
            redis.setex(cacheKey, ttl, JSON.stringify(data)).catch(err => {
              console.error('❌ User cache set error:', err);
            });
          }
          return originalJson.call(this, data);
        };
        
        next();
      } catch (error) {
        console.error('❌ User cache middleware error:', error);
        next();
      }
    };
  }

  // Cache public endpoints
  cachePublic(ttl = this.publicCacheTTL) {
    return this.cache('public', ttl);
  }

  // Invalidate cache
  async invalidate(pattern) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`🗑️ Cache invalidated: ${keys.length} keys matching "${pattern}"`);
      }
    } catch (error) {
      console.error('❌ Cache invalidation error:', error);
    }
  }

  // Invalidate user cache
  async invalidateUser(email) {
    await this.invalidate(`user:${email}:*`);
  }

  // Generate cache key
  generateCacheKey(prefix, req) {
    const key = `${prefix}:${req.method}:${req.originalUrl}`;
    
    // Add query params for GET requests
    if (req.method === 'GET' && Object.keys(req.query).length > 0) {
      const queryString = Object.keys(req.query)
        .sort()
        .map(k => `${k}=${req.query[k]}`)
        .join('&');
      return `${key}:${queryString}`;
    }
    
    return key;
  }

  // Cache statistics
  async getStats() {
    try {
      const info = await redis.info('memory');
      const keyspace = await redis.info('keyspace');
      
      return {
        memory: info,
        keyspace: keyspace,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Cache stats error:', error);
      return null;
    }
  }
}

module.exports = new CacheMiddleware();
