// config/redis.js
// Minimal wrapper using node-redis (REDIS_URL).
// Exposes: connect(), quit(), isOpen, lLen(), lPop(), rPush(), del(), keys(), raw()

const { createClient } = require('redis');

let client = null;

const redisWrapper = {
  isOpen: false,

  _ensureClient: async function () {
    if (client) return;
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    client = createClient({ url });

    client.on('error', (err) => {
      console.error('Redis client error:', err && err.message ? err.message : err);
    });
    client.on('connect', () => {
      console.log('🔌 Redis client connected (node-redis)');
    });
    client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });
  },

  connect: async function () {
    await this._ensureClient();
    if (!client) throw new Error('Redis client not initialized');
    if (!client.isOpen) {
      await client.connect();
    }
    this.isOpen = !!client.isOpen;
  },

  quit: async function () {
    if (!client) return;
    try {
      if (client.isOpen && typeof client.quit === 'function') {
        await client.quit();
      }
    } catch (e) {
      console.error('Error quitting redis client:', e && e.message ? e.message : e);
    } finally {
      this.isOpen = false;
    }
  },

  lLen: async function (key) {
    await this._ensureClient();
    if (!client) return 0;
    // node-redis exposes lLen
    try {
      return Number(await client.lLen(key) || 0);
    } catch (e) {
      // older/newer clients might have different casing; try alternate
      if (typeof client.llen === 'function') return Number(await client.llen(key) || 0);
      throw e;
    }
  },

  lPop: async function (key) {
    await this._ensureClient();
    if (!client) return null;
    try {
      return await client.lPop(key);
    } catch (e) {
      if (typeof client.lpop === 'function') return await client.lpop(key);
      throw e;
    }
  },

  rPush: async function (key, ...values) {
    await this._ensureClient();
    if (!client) return;
    try {
      return await client.rPush(key, ...values);
    } catch (e) {
      if (typeof client.rpush === 'function') return await client.rpush(key, ...values);
      throw e;
    }
  },

  del: async function (...keys) {
    await this._ensureClient();
    if (!client) return;
    return await client.del(...keys);
  },

  keys: async function (pattern) {
    await this._ensureClient();
    if (!client) return [];
    return await client.keys(pattern);
  },

  raw: function () {
    return client;
  }
};

module.exports = redisWrapper;
