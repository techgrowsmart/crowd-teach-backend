/**
 * Rate Limiting Middleware
 * Prevents abuse and improves system stability
 */

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

// Helper function to get Redis client for rate limiting
const getRedisClient = () => {
  const client = redis.raw();
  if (!client) {
    // Fallback to memory store if Redis is not available
    console.warn('⚠️ Redis not available for rate limiting, using memory store');
    return null;
  }
  return {
    sendCommand: (...args) => client.call(...args)
  };
};

// Helper to check if IP is Docker internal
const isDockerInternalIP = (ip) => {
  return ip.startsWith('172.') || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
};

// General rate limiter - DISABLED
const generalLimiter = (req, res, next) => next();

// Strict rate limiter for auth endpoints - DISABLED
const authLimiter = (req, res, next) => next();

// Very strict rate limiter for signup - DISABLED
const signupLimiter = (req, res, next) => next();

// OTP specific rate limiter - DISABLED
const otpLimiter = (req, res, next) => next();

// Email-specific rate limiter (prevents email bombing) - DISABLED
const emailLimiter = (req, res, next) => next();

// Concurrent request limiter - DISABLED
const concurrentLimiter = (maxConcurrent = 10) => (req, res, next) => next();

module.exports = {
  generalLimiter,
  authLimiter,
  signupLimiter,
  otpLimiter,
  emailLimiter,
  concurrentLimiter
};
