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

// General rate limiter - DISABLED in development
const generalLimiter = process.env.NODE_ENV === 'production' ? rateLimit({
  store: getRedisClient() ? new RedisStore({
    ...getRedisClient(),
    prefix: 'rl:general:'
  }) : undefined,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`🚫 Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
}) : (req, res, next) => next(); // Skip in development

// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  store: getRedisClient() ? new RedisStore({
    ...getRedisClient(),
    prefix: 'rl:auth:'
  }) : undefined,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`🚫 Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Too many authentication attempts, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Very strict rate limiter for signup
const signupLimiter = rateLimit({
  store: getRedisClient() ? new RedisStore({
    ...getRedisClient(),
    prefix: 'rl:signup:'
  }) : undefined,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 signup attempts per hour
  message: {
    error: 'Too many signup attempts, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`🚫 Signup rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many signup attempts',
      message: 'Too many signup attempts, please try again later.',
      retryAfter: '1 hour'
    });
  }
});

// OTP specific rate limiter
const otpLimiter = rateLimit({
  store: getRedisClient() ? new RedisStore({
    ...getRedisClient(),
    prefix: 'rl:otp:'
  }) : undefined,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 OTP attempts per windowMs
  message: {
    error: 'Too many OTP attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`🚫 OTP rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many OTP attempts',
      message: 'Too many OTP attempts, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Email-specific rate limiter (prevents email bombing)
const emailLimiter = rateLimit({
  store: getRedisClient() ? new RedisStore({
    ...getRedisClient(),
    keyGenerator: (req) => `email:${req.body?.email || req.query?.email || req.ip}`,
    prefix: 'rl:email:'
  }) : undefined,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each email to 3 requests per hour
  message: {
    error: 'Too many requests for this email, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`🚫 Email rate limit exceeded for: ${req.body?.email || req.query?.email}`);
    res.status(429).json({
      error: 'Too many requests for this email',
      message: 'Too many requests for this email, please try again later.',
      retryAfter: '1 hour'
    });
  }
});

// Concurrent request limiter
const concurrentLimiter = (maxConcurrent = 10) => {
  let currentRequests = 0;
  
  return (req, res, next) => {
    if (currentRequests >= maxConcurrent) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Server is busy, please try again in a moment.'
      });
    }
    
    currentRequests++;
    
    const originalEnd = res.end;
    res.end = function(...args) {
      currentRequests--;
      originalEnd.apply(this, args);
    };
    
    next();
  };
};

module.exports = {
  generalLimiter,
  authLimiter,
  signupLimiter,
  otpLimiter,
  emailLimiter,
  concurrentLimiter
};
