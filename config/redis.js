// const { createClient } = require("redis");

// // const redisClient = createClient({
// //     url: process.env.REDIS_URL
// // });
// const redisClient = createClient();

// redisClient.on('success', () => {
//     console.log("✅ Redis client connect successfully");
// })
// redisClient.on("error", (err) => {
//     console.error("❌ Redis Client Error", err);
// });

// (async () => {
//     await redisClient.connect();
//     await redisClient.quit()
// })();

// module.exports = redisClient;


/**
 * config/redis.js
 *
 * Multi-backend Redis adapter:
 *  - Uses Upstash REST if UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN present
 *  - Falls back to REDIS_URL (node-redis)
 *  - Otherwise falls back to local redis://127.0.0.1:6379
 *
 * Exposes the methods your app expects: connect, quit, isOpen, lLen, lPop, rPush, del, keys
 */

let _impl = null;      // underlying client implementation (Upstash or node-redis)
let _type = null;      // 'upstash' | 'node'
let _isConnecting = false;

async function initClientIfNeeded() {
  if (_impl) return;
  if (_isConnecting) {
    // wait until the other initialization finishes
    while (_isConnecting && !_impl) await new Promise(r => setTimeout(r, 50));
    return;
  }

  _isConnecting = true;
  try {
    // Try Upstash first if configured
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        const { Redis } = require('@upstash/redis');
        const upstash = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        // Test the connection
        await upstash.ping();
        _impl = upstash;
        _type = 'upstash';
        console.log('🔌 Connected to Upstash Redis');
        return;
      } catch (error) {
        console.warn('⚠️ Failed to connect to Upstash Redis, falling back to local Redis');
        console.warn(error.message);
        // Continue to try local Redis
      }
    }

    // Try local Redis if Upstash failed or not configured
    try {
      const { createClient } = require('redis');
      const localRedis = createClient({
        url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
      });
      
      localRedis.on('error', (err) => console.error('❌ Redis error:', err));
      localRedis.on('connect', () => console.log('🔌 Redis client connected'));
      localRedis.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));
      
      await localRedis.connect();
      _impl = localRedis;
      _type = 'node';
      console.log('🔌 Connected to local Redis');
    } catch (error) {
      console.error('❌ Failed to connect to any Redis instance');
      console.error(error);
      // Fallback to local Redis if Upstash fails
      try {
        const { createClient } = require('redis');
        const client = createClient({ url: 'redis://127.0.0.1:6379' });
        client.on('error', (err) => console.error('❌ node-redis error (local)', err));
        await client.connect();
        _impl = client;
        _type = 'node';
        console.warn('⚠️ Falling back to local Redis');
      } catch (fallbackError) {
        console.error('❌ Failed to connect to local Redis:', fallbackError);
        _impl = null;
        _type = null;
        throw error; // Re-throw the original error
      }
    }
  } finally {
    _isConnecting = false;
  }
}

// Wrapper we export immediately so other modules can require() this file
const redisWrapper = {
  isOpen: false,

  // ensure underlying client is initialized and connected (for node redis)
  connect: async function () {
    await initClientIfNeeded();
    if (!_impl) throw new Error('Redis client not initialized');

    if (_type === 'node') {
      // node-redis has connect() and isOpen
      if (!_impl.isOpen) {
        try {
          await _impl.connect();
          this.isOpen = true;
        } catch (e) {
          console.error('❌ Error connecting node-redis:', e.message || e);
          this.isOpen = !!_impl.isOpen;
          throw e;
        }
      } else {
        this.isOpen = true;
      }
    } else if (_type === 'upstash') {
      // Upstash REST is stateless — treat as "open"
      this.isOpen = true;
    }
  },

  quit: async function () {
    if (!_impl) return;
    try {
      if (_type === 'node' && _impl.quit) {
        await _impl.quit();
        this.isOpen = false;
      } else {
        // Upstash: no quit required (REST)
        this.isOpen = false;
      }
    } catch (e) {
      console.error('❌ Error quitting redis client:', e.message || e);
    }
  },

  // Redis commands used by the app
  lLen: async function (key) {
    await initClientIfNeeded();
    if (!_impl) return 0;
    if (_type === 'upstash') {
      const r = await _impl.llen(key);
      return Number(r || 0);
    } else {
      return await _impl.lLen(key);
    }
  },

  lPop: async function (key) {
    await initClientIfNeeded();
    if (!_impl) return null;
    if (_type === 'upstash') {
      return await _impl.lpop(key);
    } else {
      return await _impl.lPop(key);
    }
  },

  rPush: async function (key, ...values) {
    await initClientIfNeeded();
    if (!_impl) return;
    if (_type === 'upstash') {
      // Upstash rpush accepts multiple values — ensure strings
      await _impl.rpush(key, ...values);
      return;
    } else {
      return await _impl.rPush(key, ...values);
    }
  },

  del: async function (...keys) {
    await initClientIfNeeded();
    if (!_impl) return;
    if (_type === 'upstash') {
      await _impl.del(...keys);
      return;
    } else {
      return await _impl.del(...keys);
    }
  },

  keys: async function (pattern) {
    await initClientIfNeeded();
    if (!_impl) return [];
    if (_type === 'upstash') {
      // Upstash keys returns array
      const res = await _impl.keys(pattern);
      return Array.isArray(res) ? res : [];
    } else {
      return await _impl.keys(pattern);
    }
  },

  // Fallback proxy for any other calls
  raw: function () {
    return _impl;
  }
};

module.exports = redisWrapper;
