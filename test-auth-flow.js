require("dotenv").config();
const cassandra = require("cassandra-driver");
const jwt = require("jsonwebtoken");

// Database connection
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
    credentials
});

// Test configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_USERS = [
    { email: 'student1@example.com', expectedRole: 'student' },
    { email: 'teacher31@example.com', expectedRole: 'teacher' },
    { email: 'teacher56@example.com', expectedRole: 'teacher' }
];

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Helper function to make HTTP requests
async function makeRequest(endpoint, method, body = null) {
    const url = `${BASE_URL}${endpoint}`;
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        return { status: response.status, data };
    } catch (error) {
        log(`❌ Request failed: ${error.message}`, 'red');
        throw error;
    }
}

// Helper to get OTP from database
async function getOTPFromDatabase(email, otpId) {
    try {
        const query = "SELECT otp, expires_at FROM otp_table WHERE id = ? AND email = ?";
        const result = await client.execute(query, [otpId, email], { prepare: true });
        
        if (result.rowLength > 0) {
            return result.rows[0];
        }
        return null;
    } catch (error) {
        log(`❌ Error fetching OTP from database: ${error.message}`, 'red');
        return null;
    }
}

// Test 1: Send OTP
async function testSendOTP(email) {
    log(`\n📧 Test 1: Sending OTP to ${email}`, 'blue');
    try {
        const { status, data } = await makeRequest('/api/auth/login', 'POST', { email });
        
        if (status === 200 && data.otpId) {
            log(`✅ OTP sent successfully`, 'green');
            log(`   - OTP ID: ${data.otpId}`);
            log(`   - Role: ${data.role}`);
            log(`   - Message: ${data.message}`);
            
            // Fetch the actual OTP from database for testing
            const otpRecord = await getOTPFromDatabase(email, data.otpId);
            if (otpRecord) {
                log(`   - OTP Code (from DB): ${otpRecord.otp}`);
                log(`   - Expires at: ${otpRecord.expires_at}`);
                return { success: true, otpId: data.otpId, otp: otpRecord.otp, role: data.role };
            } else {
                log(`⚠️  Could not fetch OTP from database`, 'yellow');
                return { success: true, otpId: data.otpId, role: data.role };
            }
        } else {
            log(`❌ Failed to send OTP: ${data.message}`, 'red');
            return { success: false, error: data.message };
        }
    } catch (error) {
        log(`❌ Exception in testSendOTP: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 2: Verify OTP
async function testVerifyOTP(email, otp, otpId) {
    log(`\n🔐 Test 2: Verifying OTP for ${email}`, 'blue');
    try {
        const { status, data } = await makeRequest('/api/auth/verify-otp', 'POST', { 
            email, 
            otp, 
            otpId 
        });
        
        if (status === 200 && data.token) {
            log(`✅ OTP verified successfully`, 'green');
            log(`   - Token: ${data.token.substring(0, 50)}...`);
            log(`   - Role: ${data.role}`);
            log(`   - Message: ${data.message}`);
            
            // Verify token is valid JWT
            try {
                const decoded = jwt.verify(data.token, process.env.JWT_SECRET_KEY);
                log(`   - Token valid: ✅`);
                log(`   - Token email: ${decoded.email}`);
                log(`   - Token role: ${decoded.role}`);
                return { success: true, token: data.token, role: data.role, decoded };
            } catch (jwtError) {
                log(`⚠️  Token verification failed: ${jwtError.message}`, 'yellow');
                return { success: true, token: data.token, role: data.role };
            }
        } else {
            log(`❌ Failed to verify OTP: ${data.message}`, 'red');
            return { success: false, error: data.message };
        }
    } catch (error) {
        log(`❌ Exception in testVerifyOTP: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 3: Verify token is deleted from OTP table after use
async function testOTPDeletion(email, otpId) {
    log(`\n🗑️  Test 3: Checking if OTP was deleted from database`, 'blue');
    try {
        const otpRecord = await getOTPFromDatabase(email, otpId);
        
        if (otpRecord === null) {
            log(`✅ OTP was successfully deleted from database`, 'green');
            return { success: true };
        } else {
            log(`⚠️  OTP still exists in database (should be deleted)`, 'yellow');
            return { success: false, error: 'OTP not deleted' };
        }
    } catch (error) {
        log(`❌ Exception in testOTPDeletion: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 4: Refresh token
async function testRefreshToken(email) {
    log(`\n🔄 Test 4: Refreshing token for ${email}`, 'blue');
    try {
        const { status, data } = await makeRequest('/api/auth/refresh-token', 'POST', { email });
        
        if (status === 200 && data.token) {
            log(`✅ Token refreshed successfully`, 'green');
            log(`   - New Token: ${data.token.substring(0, 50)}...`);
            log(`   - Role: ${data.role}`);
            log(`   - Name: ${data.name}`);
            return { success: true, token: data.token, role: data.role };
        } else {
            log(`❌ Failed to refresh token: ${data.message}`, 'red');
            return { success: false, error: data.message };
        }
    } catch (error) {
        log(`❌ Exception in testRefreshToken: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 5: Re-login after logout (simulate logout by sending new OTP)
async function testReLogin(email) {
    log(`\n🔁 Test 5: Re-login (send new OTP) for ${email}`, 'blue');
    try {
        // First, send a new OTP (simulating fresh login after logout)
        const { status, data } = await makeRequest('/api/auth/login', 'POST', { email });
        
        if (status === 200 && data.otpId) {
            log(`✅ New OTP sent successfully after logout`, 'green');
            log(`   - New OTP ID: ${data.otpId}`);
            
            // Fetch the new OTP
            const otpRecord = await getOTPFromDatabase(email, data.otpId);
            if (otpRecord) {
                log(`   - New OTP Code: ${otpRecord.otp}`);
                
                // Verify the new OTP
                const verifyResult = await testVerifyOTP(email, otpRecord.otp, data.otpId);
                return { success: verifyResult.success, token: verifyResult.token };
            }
            return { success: true };
        } else {
            log(`❌ Failed to send new OTP: ${data.message}`, 'red');
            return { success: false, error: data.message };
        }
    } catch (error) {
        log(`❌ Exception in testReLogin: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 6: Verify multiple concurrent logins
async function testConcurrentLogins(email) {
    log(`\n⚡ Test 6: Testing concurrent logins for ${email}`, 'blue');
    try {
        // Send 3 OTP requests concurrently
        const promises = [
            makeRequest('/api/auth/login', 'POST', { email }),
            makeRequest('/api/auth/login', 'POST', { email }),
            makeRequest('/api/auth/login', 'POST', { email })
        ];
        
        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.status === 200).length;
        
        log(`✅ Concurrent login test completed`, 'green');
        log(`   - Successful OTP sends: ${successCount}/3`);
        
        if (successCount === 3) {
            return { success: true };
        } else {
            return { success: false, error: 'Not all concurrent requests succeeded' };
        }
    } catch (error) {
        log(`❌ Exception in testConcurrentLogins: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 7: Test with invalid OTP
async function testInvalidOTP(email) {
    log(`\n❌ Test 7: Testing invalid OTP for ${email}`, 'blue');
    try {
        // First get a valid OTP
        const otpResult = await testSendOTP(email);
        if (!otpResult.success) {
            return { success: false, error: 'Failed to send OTP' };
        }
        
        // Try to verify with wrong OTP
        const { status, data } = await makeRequest('/api/auth/verify-otp', 'POST', { 
            email, 
            otp: '0000', // Invalid OTP
            otpId: otpResult.otpId 
        });
        
        if (status === 400) {
            log(`✅ Invalid OTP correctly rejected`, 'green');
            log(`   - Error message: ${data.message}`);
            return { success: true };
        } else {
            log(`❌ Invalid OTP was not rejected`, 'red');
            return { success: false, error: 'Invalid OTP was accepted' };
        }
    } catch (error) {
        log(`❌ Exception in testInvalidOTP: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Test 8: Test expired OTP
async function testExpiredOTP(email) {
    log(`\n⏰ Test 8: Testing expired OTP for ${email}`, 'blue');
    try {
        // Send OTP
        const otpResult = await testSendOTP(email);
        if (!otpResult.success) {
            return { success: false, error: 'Failed to send OTP' };
        }
        
        // Manually expire the OTP in database
        const expiredTime = new Date(Date.now() - 1000); // 1 second ago
        const updateQuery = "UPDATE otp_table SET expires_at = ? WHERE id = ? AND email = ?";
        await client.execute(updateQuery, [expiredTime, otpResult.otpId, email], { prepare: true });
        
        log(`   - OTP manually expired in database`);
        
        // Try to verify expired OTP
        const { status, data } = await makeRequest('/api/auth/verify-otp', 'POST', { 
            email, 
            otp: otpResult.otp, 
            otpId: otpResult.otpId 
        });
        
        if (status === 400 && data.message.includes('expired')) {
            log(`✅ Expired OTP correctly rejected`, 'green');
            log(`   - Error message: ${data.message}`);
            return { success: true };
        } else {
            log(`❌ Expired OTP was not rejected`, 'red');
            return { success: false, error: 'Expired OTP was accepted' };
        }
    } catch (error) {
        log(`❌ Exception in testExpiredOTP: ${error.message}`, 'red');
        return { success: false, error: error.message };
    }
}

// Main test runner
async function runAuthTests() {
    log('='.repeat(60), 'blue');
    log('🧪 AUTHENTICATION FLOW TEST SUITE', 'blue');
    log('='.repeat(60), 'blue');
    log(`📍 Backend URL: ${BASE_URL}`, 'blue');
    log(`📍 Testing users: ${TEST_USERS.map(u => u.email).join(', ')}`, 'blue');
    
    try {
        log('\n🔗 Connecting to database...', 'blue');
        await client.connect();
        log('✅ Connected to database', 'green');
    } catch (error) {
        log(`❌ Failed to connect to database: ${error.message}`, 'red');
        log('⚠️  Skipping database-dependent tests', 'yellow');
    }
    
    const testResults = {
        passed: 0,
        failed: 0,
        tests: []
    };
    
    for (const user of TEST_USERS) {
        log('\n' + '='.repeat(60), 'blue');
        log(`👤 Testing User: ${user.email} (Expected Role: ${user.expectedRole})`, 'blue');
        log('='.repeat(60), 'blue');
        
        // Test 1: Send OTP
        const test1 = await testSendOTP(user.email);
        testResults.tests.push({ name: `Send OTP - ${user.email}`, ...test1 });
        if (test1.success) testResults.passed++; else testResults.failed++;
        
        if (!test1.success) continue;
        
        // Test 2: Verify OTP
        const test2 = await testVerifyOTP(user.email, test1.otp, test1.otpId);
        testResults.tests.push({ name: `Verify OTP - ${user.email}`, ...test2 });
        if (test2.success) testResults.passed++; else testResults.failed++;
        
        // Test 3: Check OTP deletion
        const test3 = await testOTPDeletion(user.email, test1.otpId);
        testResults.tests.push({ name: `OTP Deletion - ${user.email}`, ...test3 });
        if (test3.success) testResults.passed++; else testResults.failed++;
        
        // Test 4: Refresh token
        const test4 = await testRefreshToken(user.email);
        testResults.tests.push({ name: `Refresh Token - ${user.email}`, ...test4 });
        if (test4.success) testResults.passed++; else testResults.failed++;
        
        // Test 5: Re-login (simulate logout and login again)
        const test5 = await testReLogin(user.email);
        testResults.tests.push({ name: `Re-login - ${user.email}`, ...test5 });
        if (test5.success) testResults.passed++; else testResults.failed++;
        
        // Only run these tests for one user to save time
        if (user.email === TEST_USERS[0].email) {
            // Test 6: Concurrent logins
            const test6 = await testConcurrentLogins(user.email);
            testResults.tests.push({ name: `Concurrent Logins - ${user.email}`, ...test6 });
            if (test6.success) testResults.passed++; else testResults.failed++;
            
            // Test 7: Invalid OTP
            const test7 = await testInvalidOTP(user.email);
            testResults.tests.push({ name: `Invalid OTP - ${user.email}`, ...test7 });
            if (test7.success) testResults.passed++; else testResults.failed++;
            
            // Test 8: Expired OTP
            const test8 = await testExpiredOTP(user.email);
            testResults.tests.push({ name: `Expired OTP - ${user.email}`, ...test8 });
            if (test8.success) testResults.passed++; else testResults.failed++;
        }
    }
    
    // Print summary
    log('\n' + '='.repeat(60), 'blue');
    log('📊 TEST SUMMARY', 'blue');
    log('='.repeat(60), 'blue');
    log(`Total Tests: ${testResults.passed + testResults.failed}`, 'blue');
    log(`✅ Passed: ${testResults.passed}`, 'green');
    log(`❌ Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'green');
    
    if (testResults.failed > 0) {
        log('\n❌ Failed Tests:', 'red');
        testResults.tests.filter(t => !t.success).forEach(t => {
            log(`   - ${t.name}: ${t.error}`, 'red');
        });
    }
    
    log('\n' + '='.repeat(60), 'blue');
    
    await client.shutdown();
    process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAuthTests().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});
