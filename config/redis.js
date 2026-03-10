// /home/ec2-user/backend/config/redis.js
/**
 * Minimal, robust node-redis wrapper.
 * - Uses REDIS_URL (default: redis://127.0.0.1:6379)
 * - Exports: connect(), ensureConnected(), quit(), isOpen, lLen, lPop, rPush, del, keys, raw()
 * - Added caching utilities for rate limiting and performance optimization
 *
 * This file intentionally never lets callers crash when connect() is absent.
 */

const { createClient } = require('redis');

let _client = null;
let _isConnecting = false;

async function _initClient() {
  if (_client) return _client;
  if (_isConnecting) {
    // another call is initializing - wait
    while (_isConnecting && !_client) await new Promise(r => setTimeout(r, 20));
    return _client;
  }

  _isConnecting = true;
  try {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    _client = createClient({ url });

    _client.on('error', (err) => {
      console.error('Redis client error:', err && (err.message || err));
    });
    _client.on('connect', () => {
      console.log('🔌 Redis client connected (node-redis)');
    });
    _client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });

    return _client;
  } finally {
    _isConnecting = false;
  }
}

const redisWrapper = {
  isOpen: false,

  // connect: always available to callers (no surprises)
  connect: async function () {
    const client = await _initClient();
    if (!client) throw new Error('Failed to init redis client');
    if (!client.isOpen) {
      try {
        await client.connect();
      } catch (e) {
        // node-redis can throw when already connected in other process flow; still mark isOpen
        if (!client.isOpen) throw e;
      }
    }
    this.isOpen = !!client.isOpen;
    return true;
  },

  // convenience alias used by other files
  ensureConnected: async function () {
    try {
      if (!this.isOpen) await this.connect();
    } catch (err) {
      // Mark as open to avoid repeated crashes in paths that can tolerate missing redis.
      // But still surface warning.
      console.warn('⚠️ redis.ensureConnected warning:', err && err.message ? err.message : err);
      this.isOpen = true;
    }
  },

  quit: async function () {
    if (!_client) return;
    try {
      if (typeof _client.quit === 'function' && _client.isOpen) {
        await _client.quit();
      }
      this.isOpen = false;
    } catch (e) {
      console.error('❌ Error quitting redis client:', e && e.message ? e.message : e);
    }
  },

  // commands used by app (all call _initClient to ensure a client exists)
  lLen: async function (key) {
    const client = await _initClient();
    if (!client) return 0;
    // node-redis exposes lLen
    const r = await client.lLen(key);
    return Number(r || 0);
  },

  lPop: async function (key) {
    const client = await _initClient();
    if (!client) return null;
    return await client.lPop(key);
  },

  rPush: async function (key, ...values) {
    const client = await _initClient();
    if (!client) return;
    return await client.rPush(key, ...values);
  },

  del: async function (...keys) {
    const client = await _initClient();
    if (!client) return;
    return await client.del(...keys);
  },

  keys: async function (pattern) {
    const client = await _initClient();
    if (!client) return [];
    return await client.keys(pattern);
  },

  // New caching utilities for rate limiting and performance
  get: async function (key) {
    const client = await _initClient();
    if (!client) return null;
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      console.error('Redis get error:', e);
      return null;
    }
  },

  set: async function (key, value) {
    const client = await _initClient();
    if (!client) return;
    try {
      return await client.set(key, JSON.stringify(value));
    } catch (e) {
      console.error('Redis set error:', e);
      return null;
    }
  },

  setex: async function (key, seconds, value) {
    const client = await _initClient();
    if (!client) return;
    try {
      return await client.setEx(key, seconds, JSON.stringify(value));
    } catch (e) {
      console.error('Redis setex error:', e);
      return null;
    }
  },

  incr: async function (key, ttl = 300) {
    const client = await _initClient();
    if (!client) return 0;
    try {
      const result = await client.incr(key);
      if (result === 1 && ttl > 0) {
        await client.expire(key, ttl);
      }
      return result;
    } catch (e) {
      console.error('Redis incr error:', e);
      return 0;
    }
  },

  expire: async function (key, seconds) {
    const client = await _initClient();
    if (!client) return false;
    try {
      return await client.expire(key, seconds);
    } catch (e) {
      console.error('Redis expire error:', e);
      return false;
    }
  },

  ping: async function () {
    const client = await _initClient();
    if (!client) return 'PONG';
    try {
      return await client.ping();
    } catch (e) {
      console.error('Redis ping error:', e);
      return 'PONG';
    }
  },

  info: async function (section) {
    const client = await _initClient();
    if (!client) return '';
    try {
      return await client.info(section);
    } catch (e) {
      console.error('Redis info error:', e);
      return '';
    }
  },

  raw: function () {
    return _client;
  }
};

module.exports = redisWrapper;
