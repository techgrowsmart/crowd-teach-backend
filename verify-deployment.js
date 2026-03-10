const https = require('https');
const http = require('http');

// Test both local and production servers
const servers = [
  { name: 'Local', url: 'http://192.168.1.5:3000', protocol: http },
  { name: 'Production', url: 'https://growsmartserver.gogrowsmart.com', protocol: https }
];

const testUsers = [
  { email: 'student1@example.com', expectedRole: 'student' },
  { email: 'teacher56@example.com', expectedRole: 'teacher' }
];

function testLogin(server, user) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ email: user.email });
    
    const options = {
      hostname: new URL(server.url).hostname,
      port: new URL(server.url).port || (server.protocol === https ? 443 : 80),
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = server.protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            server: server.name,
            user: user.email,
            status: res.statusCode,
            response: response,
            success: res.statusCode === 200 && response.token && response.role === user.expectedRole
          });
        } catch (error) {
          resolve({
            server: server.name,
            user: user.email,
            status: res.statusCode,
            response: data,
            success: false,
            error: 'Invalid JSON response'
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        server: server.name,
        user: user.email,
        success: false,
        error: error.message
      });
    });

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing OTP bypass for test users...\n');
  
  for (const server of servers) {
    console.log(`📡 Testing ${server.name} server: ${server.url}`);
    
    for (const user of testUsers) {
      console.log(`\n👤 Testing user: ${user.email}`);
      
      try {
        const result = await testLogin(server, user);
        
        if (result.success) {
          console.log(`✅ SUCCESS - ${user.email} logged in without OTP`);
          console.log(`   Role: ${result.response.role}`);
          console.log(`   Token received: ${result.response.token ? 'YES' : 'NO'}`);
          console.log(`   Is test user: ${result.response.isTestUser || 'NO'}`);
        } else {
          console.log(`❌ FAILED - ${user.email}`);
          console.log(`   Status: ${result.status}`);
          console.log(`   Response: ${JSON.stringify(result.response || result.error)}`);
          
          if (result.response && result.response.message && result.response.message.includes('OTP')) {
            console.log(`   ⚠️  OTP bypass not working - server is asking for OTP`);
          }
        }
      } catch (error) {
        console.log(`❌ ERROR testing ${user.email}: ${error.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(50));
  }
  
  console.log('\n📋 Summary:');
  console.log('If local server works but production fails:');
  console.log('1. Deploy latest code to production');
  console.log('2. Run fix-production-test-users.js on production');
  console.log('3. Restart production server');
}

// Check if we can reach the servers first
async function checkServerHealth() {
  console.log('🏥 Checking server health...\n');
  
  for (const server of servers) {
    try {
      const healthUrl = server.url + '/api/ping';
      const hostname = new URL(healthUrl).hostname;
      const port = new URL(healthUrl).port || (server.protocol === https ? 443 : 80);
      
      const options = {
        hostname,
        port,
        path: '/api/ping',
        method: 'GET'
      };
      
      await new Promise((resolve, reject) => {
        const req = server.protocol.request(options, (res) => {
          if (res.statusCode === 200) {
            console.log(`✅ ${server.name} server is healthy`);
            resolve();
          } else {
            console.log(`⚠️  ${server.name} server responded with ${res.statusCode}`);
            resolve();
          }
        });
        
        req.on('error', () => {
          console.log(`❌ ${server.name} server is not reachable`);
          resolve();
        });
        
        req.end();
      });
    } catch (error) {
      console.log(`❌ Error checking ${server.name}: ${error.message}`);
    }
  }
  
  console.log('\n');
}

checkServerHealth().then(() => {
  runTests();
}).catch(error => {
  console.error('❌ Health check failed:', error);
});
