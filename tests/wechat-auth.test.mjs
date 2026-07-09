import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let server;
let baseUrl;
let originalFetch;
let originalAppid;
let originalSecret;

function setup() {
  before(() => {
    originalFetch = globalThis.fetch;
    originalAppid = process.env.WECHAT_MINIAPP_APPID;
    originalSecret = process.env.WECHAT_MINIAPP_SECRET;
    process.env.WECHAT_MINIAPP_APPID = 'wx-test-appid';
    process.env.WECHAT_MINIAPP_SECRET = 'wx-test-secret';
    globalThis.fetch = async (url, options) => {
      const target = String(url);
      if (target.startsWith(baseUrl || 'http://127.0.0.1')) return originalFetch(url, options);
      assert.match(target, /jscode2session/);
      assert.match(target, /appid=wx-test-appid/);
      assert.match(target, /secret=wx-test-secret/);
      if (target.includes('js_code=valid-code')) return Response.json({ openid: 'openid-student-001', session_key: 'session-key' });
      return Response.json({ errcode: 40029, errmsg: 'invalid code' });
    };
    const app = createApp({ db: openDatabase(':memory:') });
    server = createServer(app.handler);
    server.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.close();
    globalThis.fetch = originalFetch;
    if (originalAppid === undefined) delete process.env.WECHAT_MINIAPP_APPID;
    else process.env.WECHAT_MINIAPP_APPID = originalAppid;
    if (originalSecret === undefined) delete process.env.WECHAT_MINIAPP_SECRET;
    else process.env.WECHAT_MINIAPP_SECRET = originalSecret;
  });
}

async function req(path, { body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

describe('WeChat miniapp login', () => {
  setup();

  it('creates a student user and returns an authenticated state', async () => {
    const created = await req('/api/auth/wechat-login', { body: { code: 'valid-code', profile: { nickName: '微信同学' } } });
    assert.equal(created.status, 200);
    assert.equal(created.data.user.role, 'student');
    assert.equal(created.data.user.nickname, '微信同学');
    assert.ok(created.data.token);
    assert.equal(created.data.state.session.user.id, created.data.user.id);

    const second = await req('/api/auth/wechat-login', { body: { code: 'valid-code', profile: { nickName: '新昵称不覆盖' } } });
    assert.equal(second.status, 200);
    assert.equal(second.data.user.id, created.data.user.id);
  });
});

describe('WeChat miniapp login errors', () => {
  setup();

  it('rejects invalid WeChat codes', async () => {
    const result = await req('/api/auth/wechat-login', { body: { code: 'bad-code' } });
    assert.equal(result.status, 401);
    assert.match(result.data.error, /invalid code|微信登录失败/);
  });
});
