import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

let server;
let baseUrl;

async function search(body = {}) {
  const response = await fetch(`${baseUrl}/api/dishes/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: 1, pageSize: 20, itemType: 'meal', sort: 'rating_desc', ...body }),
  });
  return { status: response.status, data: await response.json() };
}

describe('dish search response cache', () => {
  before(async () => {
    const db = openDatabase(':memory:');
    const app = createApp({ db });
    server = createServer(app.handler);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('caches complete responses and coalesces concurrent misses', async () => {
    const first = await search({ query: '鸡蛋' });
    assert.equal(first.status, 200);
    assert.equal(first.data.meta.cache.hit, false);
    assert.ok(Array.isArray(first.data.items));

    const second = await search({ query: '鸡蛋' });
    assert.equal(second.status, 200);
    assert.equal(second.data.meta.cache.hit, true);
    assert.deepEqual(second.data.items, first.data.items);

    const results = await Promise.all([
      search({ query: '并发缓存验证' }),
      search({ query: '并发缓存验证' }),
      search({ query: '并发缓存验证' }),
    ]);
    assert.ok(results.every((result) => result.status === 200));
    assert.ok(results.every((result) => result.data.meta.cache));
    assert.ok(results.some((result) => result.data.meta.cache.hit || result.data.meta.cache.coalesced));
    assert.ok(results.every((result) => JSON.stringify(result.data.items) === JSON.stringify(results[0].data.items)));
  });
});
