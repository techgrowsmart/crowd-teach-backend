/**
 * Optimized Database Configuration
 * Connection pooling and query optimization
 */

const cassandra = require('cassandra-driver');

// Optimized Cassandra client with connection pooling
const createOptimizedClient = () => {
  const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
  const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']);
  const credentials = {
    username: process.env.ASTRA_DB_USERNAME,
    password: process.env.ASTRA_DB_PASSWORD
  };

  const client = new cassandra.Client({
    keyspace: process.env.ASTRA_DB_KEYSPACE,
    cloud,
    authProvider,
    credentials,
    
    // Connection pooling optimizations
    pooling: {
      coreConnectionsPerHost: {
        local: 4,
        remote: 2
      },
      maxRequestsPerConnection: 32768,
      maxQueueSize: 65536,
      heartBeatInterval: 30000,
      idleTimeout: 240000,
      reapInterval: 1000
    },
    
    // Query optimizations
    queryOptions: {
      consistency: cassandra.types.consistencies.localQuorum,
      serialConsistency: cassandra.types.consistencies.localSerial,
      prepareOnAllHosts: true,
      rePrepareOnUp: true,
      fetchSize: 5000,
      enableTrace: false
    },
    
    // Socket optimizations
    socketOptions: {
      connectTimeout: 5000,
      readTimeout: 12000,
      keepAlive: true,
      tcpNoDelay: true
    },
    
    // Retry policies
    policies: {
      retry: new cassandra.policies.retry.RetryPolicy(),
      loadBalancing: new cassandra.policies.loadBalancing.DCAwareRoundRobinPolicy()
    }
  });

  return client;
};

// Query cache for frequently executed queries
class QueryCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 5 * 60 * 1000; // 5 minutes
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// Optimized query executor
class OptimizedQueryExecutor {
  constructor(client) {
    this.client = client;
    this.queryCache = new QueryCache();
    this.preparedStatements = new Map();
  }

  // Execute query with caching and optimization
  async execute(query, params = [], options = {}) {
    const cacheKey = this.getCacheKey(query, params);
    
    // Check cache for SELECT queries
    if (query.trim().toUpperCase().startsWith('SELECT') && !options.skipCache) {
      const cached = this.queryCache.get(cacheKey);
      if (cached) {
        console.log('🎯 Query Cache HIT');
        return cached;
      }
    }

    console.log('💾 Query Cache MISS - Executing...');
    
    try {
      // Use prepared statements for repeated queries
      let result;
      if (this.shouldPrepare(query)) {
        result = await this.executePrepared(query, params, options);
      } else {
        result = await this.client.execute(query, params, {
          prepare: false,
          ...options
        });
      }

      // Cache SELECT results
      if (query.trim().toUpperCase().startsWith('SELECT') && !options.skipCache) {
        this.queryCache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      console.error('❌ Query execution error:', error);
      throw error;
    }
  }

  // Execute prepared statement
  async executePrepared(query, params, options) {
    let prepared = this.preparedStatements.get(query);
    
    if (!prepared) {
      prepared = await this.client.prepare(query);
      this.preparedStatements.set(query, prepared);
    }

    return await prepared.execute(params, options);
  }

  // Determine if query should be prepared
  shouldPrepare(query) {
    const upperQuery = query.trim().toUpperCase();
    
    // Prepare queries that are likely to be reused
    return upperQuery.includes('SELECT') && 
           (upperQuery.includes('WHERE') || upperQuery.includes('EMAIL')) &&
           !upperQuery.includes('LIMIT') &&
           !upperQuery.includes('ORDER BY');
  }

  // Get cache key for query
  getCacheKey(query, params) {
    return `${query}:${JSON.stringify(params)}`;
  }

  // Batch execute for multiple queries
  async batchExecute(queries) {
    const promises = queries.map(({ query, params, options }) => 
      this.execute(query, params, options)
    );
    
    return await Promise.all(promises);
  }

  // Clear cache
  clearCache() {
    this.queryCache.clear();
    console.log('🗑️ Query cache cleared');
  }

  // Get cache statistics
  getCacheStats() {
    return {
      size: this.queryCache.size(),
      preparedStatements: this.preparedStatements.size
    };
  }
}

// Initialize optimized client
let optimizedClient = null;
let queryExecutor = null;

const initializeOptimizedDB = async () => {
  try {
    if (!optimizedClient) {
      console.log('🚀 Initializing optimized database client...');
      optimizedClient = createOptimizedClient();
      await optimizedClient.connect();
      
      queryExecutor = new OptimizedQueryExecutor(optimizedClient);
      
      console.log('✅ Optimized database client initialized');
      
      // Warm up with common queries
      await warmUpQueries();
    }
    
    return { client: optimizedClient, executor: queryExecutor };
  } catch (error) {
    console.error('❌ Failed to initialize optimized database:', error);
    throw error;
  }
};

// Warm up common queries
const warmUpQueries = async () => {
  try {
    console.log('🔥 Warming up common queries...');
    
    const warmUpQueries = [
      'SELECT email, name, role FROM users WHERE email = ? LIMIT 1',
      'SELECT email, name, profilePic FROM teachers1 LIMIT 10',
      'SELECT COUNT(*) FROM student',
      'SELECT email, otp FROM otp_table WHERE email = ? ORDER BY id DESC LIMIT 1'
    ];

    for (const query of warmUpQueries) {
      await queryExecutor.execute(query, [], { skipCache: true });
    }
    
    console.log('✅ Query warm-up completed');
  } catch (error) {
    console.error('❌ Query warm-up failed:', error);
  }
};

// Get optimized executor
const getQueryExecutor = () => {
  if (!queryExecutor) {
    throw new Error('Database not initialized. Call initializeOptimizedDB() first.');
  }
  return queryExecutor;
};

// Health check for database
const healthCheck = async () => {
  try {
    const result = await queryExecutor.execute('SELECT now() FROM system.local');
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cacheStats: queryExecutor.getCacheStats()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Graceful shutdown
const shutdown = async () => {
  try {
    if (optimizedClient) {
      await optimizedClient.shutdown();
      console.log('✅ Database client shutdown gracefully');
    }
  } catch (error) {
    console.error('❌ Error during database shutdown:', error);
  }
};

// Handle process shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  initializeOptimizedDB,
  getQueryExecutor,
  healthCheck,
  shutdown,
  createOptimizedClient,
  OptimizedQueryExecutor,
  QueryCache
};
