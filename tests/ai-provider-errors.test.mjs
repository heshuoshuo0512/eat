import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { testAiProviderConnection } from '../server/aiProvider.js';

const servers = new Set();

async function mockProvider(handler) {
  const server = createServer(handler);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  servers.delete(server);
}

afterEach(async () => {
  await Promise.all([...servers].map(closeServer));
});

describe('AI provider failure contracts', () => {
  it('preserves 429 retry and quota headers for adaptive concurrency', async () => {
    const { baseUrl } = await mockProvider((_req, res) => {
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '3',
        'x-request-id': 'request-rate-limited',
        'x-ratelimit-limit-requests': '20',
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '3s',
      });
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
    });

    await assert.rejects(
      () => testAiProviderConnection({ apiKey: 'mock-key', baseUrl, chatModel: 'mock-chat', timeoutMs: 2_000 }),
      (error) => {
        assert.equal(error.code, 'AI_PROVIDER_RATE_LIMITED');
        assert.equal(error.status, 429);
        assert.equal(error.retryAfterMs, 3_000);
        assert.equal(error.requestId, 'request-rate-limited');
        assert.deepEqual(error.rateLimit, {
          limitRequests: '20', remainingRequests: '0', resetRequests: '3s',
          limitTokens: null, remainingTokens: null, resetTokens: null,
        });
        return true;
      },
    );
  });

  it('classifies authentication and upstream failures without retry ambiguity', async () => {
    let status = 401;
    const { baseUrl } = await mockProvider((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: status === 401 ? 'invalid key' : 'upstream unavailable' } }));
    });

    await assert.rejects(
      () => testAiProviderConnection({ apiKey: 'mock-key', baseUrl, chatModel: 'mock-chat' }),
      (error) => error.code === 'AI_PROVIDER_AUTH_FAILED' && error.status === 401,
    );
    status = 503;
    await assert.rejects(
      () => testAiProviderConnection({ apiKey: 'mock-key', baseUrl, chatModel: 'mock-chat' }),
      (error) => error.code === 'AI_PROVIDER_UNAVAILABLE' && error.status === 503,
    );
  });

  it('normalizes connection refusal as a retryable network error', async () => {
    const { server, baseUrl } = await mockProvider((_req, res) => res.end('{}'));
    await closeServer(server);
    await assert.rejects(
      () => testAiProviderConnection({ apiKey: 'mock-key', baseUrl, chatModel: 'mock-chat', timeoutMs: 1_000 }),
      (error) => error.code === 'AI_PROVIDER_NETWORK_ERROR',
    );
  });
});
