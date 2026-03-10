/**
 * Request Timeout and Retry Middleware
 * Improves reliability and prevents hanging requests
 */

const { performance } = require('perf_hooks');

// Request timeout middleware
const requestTimeout = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const startTime = performance.now();
    
    // Set timeout
    const timeout = setTimeout(() => {
      const elapsed = performance.now() - startTime;
      console.log(`⏰ Request timeout for ${req.method} ${req.originalUrl} after ${elapsed.toFixed(2)}ms`);
      
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request Timeout',
          message: 'Request took too long to process',
          timeout: timeoutMs,
          elapsed: elapsed
        });
      }
    }, timeoutMs);

    // Clear timeout on response finish
    res.on('finish', () => {
      clearTimeout(timeout);
      const elapsed = performance.now() - startTime;
      console.log(`✅ Request completed: ${req.method} ${req.originalUrl} in ${elapsed.toFixed(2)}ms`);
    });

    // Clear timeout on response close
    res.on('close', () => {
      clearTimeout(timeout);
    });

    next();
  };
};

// Retry logic for failed requests
class RetryHandler {
  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  // Exponential backoff delay
  getDelay(attempt) {
    return this.baseDelay * Math.pow(2, attempt - 1);
  }

  // Retry function for async operations
  async retry(operation, context = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${this.maxRetries} for ${context.operation || 'operation'}`);
        
        const result = await operation();
        
        if (attempt > 1) {
          console.log(`✅ Retry success on attempt ${attempt} for ${context.operation || 'operation'}`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          console.log(`❌ Non-retryable error for ${context.operation || 'operation'}: ${error.message}`);
          throw error;
        }
        
        if (attempt === this.maxRetries) {
          console.log(`❌ All retries failed for ${context.operation || 'operation'}: ${error.message}`);
          throw error;
        }
        
        const delay = this.getDelay(attempt);
        console.log(`⏳ Retry ${attempt} failed for ${context.operation || 'operation'}, retrying in ${delay}ms: ${error.message}`);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError;
  }

  // Determine if error should not be retried
  shouldNotRetry(error) {
    const nonRetryableErrors = [
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError'
    ];
    
    const nonRetryableStatusCodes = [400, 401, 403, 404, 409, 422];
    
    return (
      nonRetryableErrors.includes(error.name) ||
      nonRetryableStatusCodes.includes(error.statusCode) ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND'
    );
  }

  // Sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Database retry wrapper
const withDatabaseRetry = (operation, context = {}) => {
  const retryHandler = new RetryHandler(3, 500); // 3 retries, 500ms base delay
  return retryHandler.retry(operation, { ...context, operation: 'database_query' });
};

// External API retry wrapper
const withApiRetry = (operation, context = {}) => {
  const retryHandler = new RetryHandler(2, 1000); // 2 retries, 1s base delay
  return retryHandler.retry(operation, { ...context, operation: 'external_api' });
};

// Circuit breaker pattern
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  async execute(operation, context = {}) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      } else {
        this.state = 'HALF_OPEN';
        console.log('🔓 Circuit breaker moving to HALF_OPEN');
      }
    }

    try {
      const result = await operation();
      
      if (this.state === 'HALF_OPEN') {
        this.reset();
        console.log('✅ Circuit breaker reset to CLOSED');
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      
      if (this.state === 'OPEN') {
        console.log('🚫 Circuit breaker is OPEN');
        throw new Error('Circuit breaker is OPEN');
      }
      
      throw error;
    }
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      console.log('🚫 Circuit breaker opened due to failures');
    }
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt
    };
  }
}

// Global circuit breakers
const circuitBreakers = {
  database: new CircuitBreaker(5, 30000), // 5 failures, 30s timeout
  email: new CircuitBreaker(3, 60000),    // 3 failures, 60s timeout
  externalApi: new CircuitBreaker(3, 45000) // 3 failures, 45s timeout
};

// Circuit breaker middleware
const withCircuitBreaker = (breakerName) => {
  return (operation, context = {}) => {
    const breaker = circuitBreakers[breakerName];
    if (!breaker) {
      throw new Error(`Circuit breaker '${breakerName}' not found`);
    }
    
    return breaker.execute(operation, { ...context, circuitBreaker: breakerName });
  };
};

// Request health check
const healthCheck = async () => {
  const checks = {
    circuitBreakers: {},
    timestamp: new Date().toISOString()
  };
  
  for (const [name, breaker] of Object.entries(circuitBreakers)) {
    checks.circuitBreakers[name] = breaker.getState();
  }
  
  return checks;
};

module.exports = {
  requestTimeout,
  RetryHandler,
  withDatabaseRetry,
  withApiRetry,
  CircuitBreaker,
  withCircuitBreaker,
  circuitBreakers,
  healthCheck
};
