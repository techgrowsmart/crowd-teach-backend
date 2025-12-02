// Auto-generated test cases from live requests
// Run with: npx mocha generated_tests.spec.js

const request = require('supertest');
const assert = require('assert');
const app = require('../app.js'); // change to your app entry point

describe('Auto Generated API Tests', function() {

  it('GET / should return 200', async function () {
    const res = await request(app)
        .get('/');
    assert.strictEqual(res.status, 200);
  });

  it('GET / should return 200', async function () {
    const res = await request(app)
        .get('/');
    assert.strictEqual(res.status, 200);
  });

  it('GET / should return 200', async function () {
    const res = await request(app)
        .get('/');
    assert.strictEqual(res.status, 200);
  });

  it('GET / should return 200', async function () {
    const res = await request(app)
        .get('/');
    assert.strictEqual(res.status, 200);
  });

  it('GET /api/ping should return 200', async function () {
    const res = await request(app)
        .get('/api/ping');
    assert.strictEqual(res.status, 200);
  });

  it('GET /api/ping should return 200', async function () {
    const res = await request(app)
        .get('/api/ping');
    assert.strictEqual(res.status, 200);
  });

  it('GET /api/ping should return 200', async function () {
    const res = await request(app)
        .get('/api/ping');
    assert.strictEqual(res.status, 200);
  });
})
