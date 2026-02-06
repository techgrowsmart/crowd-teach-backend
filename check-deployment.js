const https = require('https');
const http = require('http');

// Configuration - replace with your actual EC2 server URL
const SERVER_URL = 'https://growsmartserver.gogrowsmart.com'; // Update with your actual domain
const BASE_URL = SERVER_URL;

console.log('🔍 Checking deployment status...\n');

// Test endpoints that should exist with the latest changes
const endpoints = [
    { path: '/api/posts/all', method: 'GET', description: 'Posts endpoint (MongoDB version)' },
    { path: '/api/posts/create', method: 'POST', description: 'Create post endpoint' },
    { path: '/api/teacherProfile', method: 'POST', description: 'Teacher profile endpoint' },
    { path: '/health', method: 'GET', description: 'Health check' }
];

function testEndpoint(endpoint) {
    return new Promise((resolve) => {
        const protocol = SERVER_URL.startsWith('https') ? https : http;
        
        const options = {
            hostname: new URL(SERVER_URL).hostname,
            port: new URL(SERVER_URL).port || (SERVER_URL.startsWith('https') ? 443 : 80),
            path: endpoint.path,
            method: endpoint.method,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Deployment-Check/1.0'
            },
            timeout: 10000
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    endpoint: endpoint.path,
                    status: res.statusCode,
                    description: endpoint.description,
                    success: res.statusCode !== 404,
                    response: data.substring(0, 200) // First 200 chars
                });
            });
        });

        req.on('error', (error) => {
            resolve({
                endpoint: endpoint.path,
                status: 'ERROR',
                description: endpoint.description,
                success: false,
                error: error.message
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                endpoint: endpoint.path,
                status: 'TIMEOUT',
                description: endpoint.description,
                success: false,
                error: 'Request timeout'
            });
        });

        // For POST endpoints, send empty body
        if (endpoint.method === 'POST') {
            req.write('{}');
        }
        
        req.end();
    });
}

async function checkDeployment() {
    console.log(`📡 Testing server: ${SERVER_URL}\n`);
    
    const results = await Promise.all(endpoints.map(testEndpoint));
    
    console.log('📊 Results:');
    console.log('='.repeat(60));
    
    let allSuccess = true;
    
    results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        const statusCode = result.status !== 'ERROR' && result.status !== 'TIMEOUT' ? ` (${result.status})` : '';
        
        console.log(`${status} ${result.endpoint}${statusCode} - ${result.description}`);
        
        if (!result.success) {
            allSuccess = false;
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            } else if (result.response && result.response.includes('Cannot')) {
                console.log(`   Response: ${result.response.substring(0, 100)}...`);
            }
        }
    });
    
    console.log('='.repeat(60));
    
    if (allSuccess) {
        console.log('🎉 All endpoints are accessible! Latest changes appear to be deployed.');
    } else {
        console.log('⚠️  Some endpoints are returning 404 or errors. Deployment may need updating.');
        console.log('\n💡 To deploy latest changes:');
        console.log('   1. SSH into EC2 server');
        console.log('   2. cd /path/to/backend');
        console.log('   3. git pull origin main');
        console.log('   4. npm install');
        console.log('   5. pm2 restart app.js  # or docker-compose up -d --build');
    }
    
    // Check specific MongoDB vs Cassandra routes
    console.log('\n🔍 Route Analysis:');
    const postsEndpoint = results.find(r => r.endpoint === '/api/posts/all');
    if (postsEndpoint && postsEndpoint.response) {
        if (postsEndpoint.response.includes('MongoDB') || postsEndpoint.response.includes('mongoose')) {
            console.log('✅ Using MongoDB routes (posts-mongo.js) - Latest version');
        } else if (postsEndpoint.response.includes('Cassandra') || postsEndpoint.response.includes('cassandra-driver')) {
            console.log('⚠️  Still using Cassandra routes (posts.js) - Needs update');
        }
    }
}

checkDeployment().catch(console.error);
