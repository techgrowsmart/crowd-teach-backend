const fs = require('fs');
const path = require('path');
const express = require('express');

const router = express.Router();
const testFilePath = path.join(__dirname, 'request_logger_simulation_test.spec.js');

function closeTestFile() {
    if (!fs.existsSync(testFilePath)) return;
    let fileContent = fs.readFileSync(testFilePath, 'utf8').trim();
    if (!fileContent.endsWith('});')) {
        fs.appendFileSync(testFilePath, '\n});\n');
    }
}

if (process.env.LOG_REQUEST === 'true') {
    // Reset test file on startup
    fs.writeFileSync(
        testFilePath,
        `// Auto-generated test cases from live requests
// Run with: npx mocha generated_tests.spec.js

const request = require('supertest');
const assert = require('assert');
const app = require('./server'); // change to your app entry point

describe('Auto Generated API Tests', function() {
`
    );

    function requestLogger(req, res, next) {
        const oldSend = res.send;
        res.send = function (data) {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                const testCase = `
  it('${req.method} ${req.originalUrl} should return ${res.statusCode}', async function() {
    const res = await request(app)
      .${req.method.toLowerCase()}('${req.originalUrl}')${
                    req.method !== 'GET' ? `.send(${JSON.stringify(req.body)})` : ''
                };
    assert.strictEqual(res.status, ${res.statusCode});
  });
`;
                fs.appendFileSync(testFilePath, testCase);
            }
            return oldSend.apply(res, arguments);
        };
        next();
    }

    router.use(requestLogger);

    // Download latest file (ensure closure first)
    router.get('/download-tests', (req, res) => {
        closeTestFile();
        res.download(testFilePath);
    });

    // Close file properly on shutdown
    process.on('SIGINT', () => {
        closeTestFile();
        process.exit();
    });
    process.on('exit', closeTestFile);
}

module.exports = router;
