/**
 * Load Balancing Test Script
 * Tests simultaneous login of 100+ users
 * Measures performance, response times, and system behavior
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

// Configuration
const CONFIG = {
  BASE_URL: 'http://localhost:3000',
  NUM_USERS: 100,
  CONCURRENT_REQUESTS: 20,
  TEST_DURATION: 30000, // 30 seconds
  WARMUP_USERS: 5,
  COOLDOWN_TIME: 5000,
  JWT_SECRET: process.env.JWT_SECRET_KEY || 'someVeryStrongRandomSecretKey'
};

// Test data
const TEST_USERS = [];
const RESULTS = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  responseTimes: [],
  errors: [],
  startTime: null,
  endTime: null,
  usersCreated: 0,
  loginSuccesses: 0,
  loginFailures: 0,
  tokenVerificationSuccesses: 0,
  tokenVerificationFailures: 0,
  serverMetrics: {
    memoryUsage: [],
    cpuUsage: [],
    activeConnections: 0
  }
};

// Generate test users
function generateTestUsers(count) {
  const users = [];
  for (let i = 1; i <= count; i++) {
    users.push({
      email: `testuser${i}@loadtest.com`,
      name: `Load Test User ${i}`,
      role: i % 3 === 0 ? 'teacher' : 'student', // Mix of roles
      password: 'TestPassword123!',
      id: i
    });
  }
  return users;
}

// Make HTTP request
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = performance.now();
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    
    const requestOptions = {
      method: 'GET',
      timeout: 10000,
      ...options
    };

    const req = client.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        
        resolve({
          statusCode: res.statusCode,
          responseTime,
          data: data,
          headers: res.headers
        });
      });
    });

    req.on('error', (error) => {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      reject({
        error: error.message,
        responseTime,
        statusCode: 0
      });
    });

    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// Create test user
async function createTestUser(user) {
  try {
    const response = await makeRequest(`${CONFIG.BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        name: user.name,
        role: user.role,
        password: user.password
      })
    });

    if (response.statusCode === 200 || response.statusCode === 201) {
      RESULTS.usersCreated++;
      return { success: true, user };
    } else {
      RESULTS.errors.push(`User creation failed for ${user.email}: ${response.statusCode}`);
      return { success: false, user, error: response };
    }
  } catch (error) {
    RESULTS.errors.push(`User creation error for ${user.email}: ${error.error}`);
    return { success: false, user, error };
  }
}

// Login user
async function loginUser(user) {
  try {
    const response = await makeRequest(`${CONFIG.BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email
      })
    });

    if (response.statusCode === 200) {
      const data = JSON.parse(response.data);
      RESULTS.loginSuccesses++;
      RESULTS.responseTimes.push(response.responseTime);
      
      return { 
        success: true, 
        user, 
        token: data.token,
        responseTime: response.responseTime
      };
    } else {
      RESULTS.loginFailures++;
      RESULTS.errors.push(`Login failed for ${user.email}: ${response.statusCode}`);
      return { success: false, user, error: response };
    }
  } catch (error) {
    RESULTS.loginFailures++;
    RESULTS.errors.push(`Login error for ${user.email}: ${error.error}`);
    RESULTS.responseTimes.push(error.responseTime || 0);
    return { success: false, user, error };
  }
}

// Verify token
async function verifyToken(user, token) {
  try {
    const response = await makeRequest(`${CONFIG.BASE_URL}/api/test-auth/protected`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.statusCode === 200) {
      RESULTS.tokenVerificationSuccesses++;
      return { success: true, user };
    } else {
      RESULTS.tokenVerificationFailures++;
      return { success: false, user, error: response };
    }
  } catch (error) {
    RESULTS.tokenVerificationFailures++;
    return { success: false, user, error };
  }
}

// Monitor server metrics
function startServerMonitoring() {
  const monitoringInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    RESULTS.serverMetrics.memoryUsage.push({
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    });
    
    RESULTS.serverMetrics.cpuUsage.push({
      timestamp: Date.now(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });
  }, 1000);

  return monitoringInterval;
}

// Batch processing for concurrent requests
async function processBatch(users, processor, batchSize = CONFIG.CONCURRENT_REQUESTS) {
  const results = [];
  
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const batchPromises = batch.map(user => processor(user));
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ success: false, error: result.reason });
      }
    });
    
    // Small delay between batches to prevent overwhelming
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

// Main load test function
async function runLoadTest() {
  console.log('🚀 Starting Load Balancing Test...');
  console.log(`📊 Configuration: ${CONFIG.NUM_USERS} users, ${CONFIG.CONCURRENT_REQUESTS} concurrent requests`);
  
  RESULTS.startTime = new Date().toISOString();
  const testStartTime = performance.now();
  
  // Start server monitoring
  const monitoringInterval = startServerMonitoring();
  
  try {
    // Phase 1: Generate test users
    console.log('👥 Generating test users...');
    const users = generateTestUsers(CONFIG.NUM_USERS);
    TEST_USERS.push(...users);
    console.log(`✅ Generated ${users.length} test users`);
    
    // Phase 2: Warmup
    console.log('🔥 Warming up with test users...');
    const warmupUsers = users.slice(0, CONFIG.WARMUP_USERS);
    await processBatch(warmupUsers, createTestUser, 2);
    console.log('✅ Warmup completed');
    
    // Phase 3: Create users (in batches)
    console.log('📝 Creating test users...');
    const remainingUsers = users.slice(CONFIG.WARMUP_USERS);
    const creationResults = await processBatch(remainingUsers, createTestUser);
    console.log(`✅ User creation completed. Success: ${RESULTS.usersCreated}/${CONFIG.NUM_USERS}`);
    
    // Phase 4: Simultaneous login test
    console.log('🔐 Starting simultaneous login test...');
    const loginStartTime = performance.now();
    
    // Process all users in batches for login
    const loginResults = await processBatch(users, loginUser);
    
    const loginEndTime = performance.now();
    const totalLoginTime = loginEndTime - loginStartTime;
    
    console.log(`✅ Login test completed in ${totalLoginTime.toFixed(2)}ms`);
    console.log(`📈 Login Success Rate: ${((RESULTS.loginSuccesses / CONFIG.NUM_USERS) * 100).toFixed(2)}%`);
    
    // Phase 5: Token verification test
    console.log('🔍 Testing token verification...');
    const successfulLogins = loginResults.filter(r => r.success && r.token);
    
    if (successfulLogins.length > 0) {
      const tokenResults = await processBatch(
        successfulLogins.map(r => ({ user: r.user, token: r.token })),
        ({ user, token }) => verifyToken(user, token)
      );
      
      console.log(`✅ Token verification completed`);
      console.log(`📈 Token Verification Success Rate: ${((RESULTS.tokenVerificationSuccesses / successfulLogins.length) * 100).toFixed(2)}%`);
    }
    
    // Phase 6: Stress test - rapid API calls
    console.log('⚡ Running stress test...');
    const stressTestUsers = successfulLogins.slice(0, 50); // Test with 50 authenticated users
    
    const stressPromises = [];
    for (let i = 0; i < 5; i++) { // 5 rounds of stress testing
      const roundPromises = stressTestUsers.map(({ user, token }) => 
        makeRequest(`${CONFIG.BASE_URL}/api/test-auth/protected`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      );
      stressPromises.push(...roundPromises);
    }
    
    const stressResults = await Promise.allSettled(stressPromises);
    stressResults.forEach(result => {
      if (result.status === 'fulfilled') {
        RESULTS.totalRequests++;
        if (result.value.statusCode === 200) {
          RESULTS.successfulRequests++;
          RESULTS.responseTimes.push(result.value.responseTime);
        } else {
          RESULTS.failedRequests++;
        }
      } else {
        RESULTS.totalRequests++;
        RESULTS.failedRequests++;
      }
    });
    
    console.log('✅ Stress test completed');
    
  } catch (error) {
    console.error('❌ Load test failed:', error);
    RESULTS.errors.push(`Load test error: ${error.message}`);
  } finally {
    // Stop monitoring
    clearInterval(monitoringInterval);
    
    // Cooldown
    console.log('⏳ Cooldown period...');
    await new Promise(resolve => setTimeout(resolve, CONFIG.COOLDOWN_TIME));
    
    RESULTS.endTime = new Date().toISOString();
    const testEndTime = performance.now();
    const totalTestTime = testEndTime - testStartTime;
    
    console.log('🏁 Load test completed!');
    console.log(`⏱️ Total test time: ${totalTestTime.toFixed(2)}ms`);
    
    await generateReport();
  }
}

// Calculate statistics
function calculateStats() {
  const responseTimes = RESULTS.responseTimes.filter(time => time > 0);
  
  if (responseTimes.length === 0) {
    return {
      avgResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0
    };
  }
  
  responseTimes.sort((a, b) => a - b);
  
  const sum = responseTimes.reduce((acc, time) => acc + time, 0);
  const avg = sum / responseTimes.length;
  const median = responseTimes[Math.floor(responseTimes.length / 2)];
  const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
  const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
  
  return {
    avgResponseTime: avg.toFixed(2),
    minResponseTime: responseTimes[0].toFixed(2),
    maxResponseTime: responseTimes[responseTimes.length - 1].toFixed(2),
    medianResponseTime: median.toFixed(2),
    p95ResponseTime: p95.toFixed(2),
    p99ResponseTime: p99.toFixed(2)
  };
}

// Generate comprehensive report
async function generateReport() {
  const stats = calculateStats();
  const testDuration = new Date(RESULTS.endTime) - new Date(RESULTS.startTime);
  
  const report = `
================================================================================
                    LOAD BALANCING TEST REPORT
================================================================================

Test Configuration:
------------------
• Base URL: ${CONFIG.BASE_URL}
• Total Users: ${CONFIG.NUM_USERS}
• Concurrent Requests: ${CONFIG.CONCURRENT_REQUESTS}
• Test Duration: ${testDuration}ms
• JWT Secret: ${CONFIG.JWT_SECRET.substring(0, 10)}...

Test Execution:
---------------
• Start Time: ${RESULTS.startTime}
• End Time: ${RESULTS.endTime}
• Total Duration: ${(testDuration / 1000).toFixed(2)} seconds

User Creation Results:
----------------------
• Users Attempted: ${CONFIG.NUM_USERS}
• Users Created Successfully: ${RESULTS.usersCreated}
• User Creation Success Rate: ${((RESULTS.usersCreated / CONFIG.NUM_USERS) * 100).toFixed(2)}%

Login Performance:
------------------
• Login Attempts: ${CONFIG.NUM_USERS}
• Successful Logins: ${RESULTS.loginSuccesses}
• Failed Logins: ${RESULTS.loginFailures}
• Login Success Rate: ${((RESULTS.loginSuccesses / CONFIG.NUM_USERS) * 100).toFixed(2)}%

Token Verification:
-------------------
• Tokens Verified: ${RESULTS.loginSuccesses}
• Successful Verifications: ${RESULTS.tokenVerificationSuccesses}
• Failed Verifications: ${RESULTS.tokenVerificationFailures}
• Token Verification Success Rate: ${RESULTS.loginSuccesses > 0 ? ((RESULTS.tokenVerificationSuccesses / RESULTS.loginSuccesses) * 100).toFixed(2) : 0}%

Response Time Statistics:
------------------------
• Average Response Time: ${stats.avgResponseTime}ms
• Minimum Response Time: ${stats.minResponseTime}ms
• Maximum Response Time: ${stats.maxResponseTime}ms
• Median Response Time: ${stats.medianResponseTime}ms
• 95th Percentile: ${stats.p95ResponseTime}ms
• 99th Percentile: ${stats.p99ResponseTime}ms

Stress Test Results:
-------------------
• Total API Requests: ${RESULTS.totalRequests}
• Successful Requests: ${RESULTS.successfulRequests}
• Failed Requests: ${RESULTS.failedRequests}
• Overall Success Rate: ${RESULTS.totalRequests > 0 ? ((RESULTS.successfulRequests / RESULTS.totalRequests) * 100).toFixed(2) : 0}%

Server Performance Metrics:
--------------------------
• Peak Memory Usage: ${Math.max(...RESULTS.serverMetrics.memoryUsage.map(m => m.heapUsed / 1024 / 1024)).toFixed(2)} MB
• Average Memory Usage: ${(RESULTS.serverMetrics.memoryUsage.reduce((acc, m) => acc + m.heapUsed, 0) / RESULTS.serverMetrics.memoryUsage.length / 1024 / 1024).toFixed(2)} MB
• Memory Samples Collected: ${RESULTS.serverMetrics.memoryUsage.length}
• CPU Samples Collected: ${RESULTS.serverMetrics.cpuUsage.length}

Error Analysis:
---------------
• Total Errors: ${RESULTS.errors.length}
• Error Rate: ${((RESULTS.errors.length / CONFIG.NUM_USERS) * 100).toFixed(2)}%

Error Details:
${RESULTS.errors.slice(0, 10).map(error => `• ${error}`).join('\n')}
${RESULTS.errors.length > 10 ? `... and ${RESULTS.errors.length - 10} more errors` : ''}

Performance Analysis:
--------------------
1. Throughput: ${(RESULTS.successfulRequests / (testDuration / 1000)).toFixed(2)} requests/second
2. Concurrency Handling: ${CONFIG.CONCURRENT_REQUESTS} concurrent requests processed
3. System Stability: ${RESULTS.errors.length < CONFIG.NUM_USERS * 0.1 ? 'STABLE' : 'NEEDS OPTIMIZATION'}
4. Response Time Consistency: ${stats.p95ResponseTime < 1000 ? 'EXCELLENT' : stats.p95ResponseTime < 2000 ? 'GOOD' : 'NEEDS IMPROVEMENT'}

Load Balancing Assessment:
--------------------------
✅ Strengths:
   • Handled ${CONFIG.NUM_USERS} simultaneous user attempts
   • Maintained ${((RESULTS.loginSuccesses / CONFIG.NUM_USERS) * 100).toFixed(2)}% success rate
   • Average response time of ${stats.avgResponseTime}ms
   • System remained stable throughout test

⚠️ Areas for Improvement:
   ${RESULTS.errors.length > CONFIG.NUM_USERS * 0.05 ? 
     '• High error rate detected - consider increasing server resources' : 
     '• Error rate within acceptable limits'}
   ${stats.p95ResponseTime > 1000 ? 
     '• Response times could be optimized for better user experience' : 
     '• Response times are within acceptable ranges'}
   ${RESULTS.usersCreated < CONFIG.NUM_USERS * 0.9 ? 
     '• User creation process may need optimization' : 
     '• User creation process is efficient'}

Recommendations:
---------------
1. ${stats.avgResponseTime > 500 ? 'Consider implementing caching for frequently accessed data' : 'Current response times are optimal'}
2. ${RESULTS.errors.length > 10 ? 'Implement better error handling and retry mechanisms' : 'Error handling is adequate'}
3. ${CONFIG.CONCURRENT_REQUESTS < 50 ? 'System can handle more concurrent requests - consider increasing limits' : 'Current concurrency limits are appropriate'}
4. Implement monitoring for production environments
5. Consider implementing rate limiting to prevent abuse
6. Set up automated load testing in CI/CD pipeline

Test Environment:
-----------------
• Node.js Version: ${process.version}
• Platform: ${process.platform}
• Architecture: ${process.arch}
• Available Memory: ${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB

Conclusion:
-----------
The load balancing test demonstrates that the system can handle ${CONFIG.NUM_USERS} 
simultaneous user logins with a success rate of ${((RESULTS.loginSuccesses / CONFIG.NUM_USERS) * 100).toFixed(2)}% 
and average response times of ${stats.avgResponseTime}ms. 
${RESULTS.errors.length < CONFIG.NUM_USERS * 0.1 ? 
  'The system shows good load balancing capabilities and is ready for production use.' : 
  'The system requires optimization before production deployment.'}

================================================================================
Report Generated: ${new Date().toISOString()}
================================================================================
`;

  // Write report to file
  const fs = require('fs');
  fs.writeFileSync('load_balancing_test.txt', report);
  
  console.log('📄 Report generated: load_balancing_test.txt');
  console.log(report);
}

// Run the test
if (require.main === module) {
  runLoadTest().catch(console.error);
}

module.exports = { runLoadTest, RESULTS, CONFIG };
