const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

describe('App & API Endpoints Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });

  it('GET /api-docs/ - trả về HTTP 200 Swagger UI tài liệu API', async () => {
    const res = await fetch(`${baseUrl}/api-docs/`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Swagger UI') || html.includes('swagger-ui'));
  });

  it('POST /api/auth/register - thiếu dữ liệu trả về 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.status, 'fail');
    assert.ok(body.message.includes('Tên đăng nhập không được để trống'));
  });

  it('POST /api/auth/login - thiếu dữ liệu trả về 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.status, 'fail');
    assert.ok(body.message.includes('Vui lòng nhập đầy đủ'));
  });

  it('GET /api/auth/me - không có JWT token trả về 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.status, 'fail');
    assert.ok(body.message.includes('Thiếu token'));
  });

  it('GET /api/non-existent-route - trả về 404 Not Found', async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.status, 'fail');
    assert.ok(body.message.includes('không tồn tại'));
  });
});
