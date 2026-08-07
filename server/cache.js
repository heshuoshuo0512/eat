import { createHash } from 'node:crypto';

let IORedis;
try {
  const mod = await import('ioredis');
  IORedis = mod.default || mod;
} catch {
  IORedis = null;
}

function createMemoryCache({ maxEntries = 2_000 } = {}) {
  const memory = new Map();

  function sweepExpired() {
    const current = Date.now();
    for (const [key, entry] of memory) {
      if (entry.expiresAt && entry.expiresAt <= current) memory.delete(key);
    }
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  function entryFor(key) {
    const entry = memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return entry;
  }

  return {
    backend: 'memory',
    isDistributed: false,
    get(key) {
      return entryFor(key)?.value ?? null;
    },
    set(key, value, ttlMs = 30_000) {
      sweepExpired();
      memory.delete(key);
      memory.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    },
    del(key) {
      return memory.delete(key) ? 1 : 0;
    },
    increment(key, ttlMs = 60_000) {
      sweepExpired();
      const existing = entryFor(key);
      const value = Number(existing?.value || 0) + 1;
      const expiresAt = existing?.expiresAt || (ttlMs > 0 ? Date.now() + ttlMs : 0);
      memory.delete(key);
      memory.set(key, { value, expiresAt });
      return value;
    },
    setIfAbsent(key, value, ttlMs = 30_000) {
      sweepExpired();
      if (entryFor(key)) return false;
      memory.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
      return true;
    },
    deleteIfValue(key, expectedValue) {
      const entry = entryFor(key);
      if (!entry || entry.value !== expectedValue) return false;
      memory.delete(key);
      return true;
    },
    async ping() {
      return true;
    },
    async status() {
      return { ok: true, backend: 'memory', distributed: false, degraded: Boolean(process.env.REDIS_URL) };
    },
    async close() {},
    size() {
      sweepExpired();
      return memory.size;
    }
  };
}

function createRedisCache(url, fallback) {
  const client = new IORedis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3000),
    commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 2000),
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    }
  });
  let connectPromise = null;

  async function connected() {
    if (client.status === 'ready') return true;
    if (!connectPromise) {
      connectPromise = client.connect()
        .then(() => true)
        .catch(() => false)
        .finally(() => { connectPromise = null; });
    }
    return connectPromise;
  }

  async function withFallback(redisOperation, fallbackOperation) {
    if (await connected()) {
      try {
        return await redisOperation();
      } catch {}
    }
    return fallbackOperation();
  }

  return {
    backend: 'redis',
    isDistributed: true,
    get(key) {
      return withFallback(async () => {
        const raw = await client.get(key);
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      }, () => fallback.get(key));
    },
    set(key, value, ttlMs = 30_000) {
      return withFallback(
        () => ttlMs > 0
          ? client.set(key, JSON.stringify(value), 'PX', ttlMs)
          : client.set(key, JSON.stringify(value)),
        () => fallback.set(key, value, ttlMs)
      );
    },
    del(key) {
      return withFallback(() => client.del(key), () => fallback.del(key));
    },
    increment(key, ttlMs = 60_000) {
      return withFallback(
        () => client.eval(`
          local value = redis.call('INCR', KEYS[1])
          if value == 1 and tonumber(ARGV[1]) > 0 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
          end
          return value
        `, 1, key, ttlMs),
        () => fallback.increment(key, ttlMs)
      ).then(Number);
    },
    setIfAbsent(key, value, ttlMs = 30_000) {
      return withFallback(
        async () => (await client.set(key, JSON.stringify(value), 'PX', ttlMs, 'NX')) === 'OK',
        () => fallback.setIfAbsent(key, value, ttlMs)
      );
    },
    deleteIfValue(key, expectedValue) {
      return withFallback(
        async () => Number(await client.eval(`
          if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
          end
          return 0
        `, 1, key, JSON.stringify(expectedValue))) === 1,
        () => fallback.deleteIfValue(key, expectedValue)
      );
    },
    async ping() {
      if (!(await connected())) return false;
      try { return (await client.ping()) === 'PONG'; } catch { return false; }
    },
    async status() {
      const ok = await this.ping();
      return { ok, backend: 'redis', distributed: true, degraded: !ok };
    },
    async close() {
      if (client.status === 'end') return;
      try { await client.quit(); } catch { client.disconnect(); }
    }
  };
}

export function createCache() {
  const fallback = createMemoryCache({
    maxEntries: Number(process.env.MEMORY_CACHE_MAX_ENTRIES || 2_000)
  });
  if (process.env.REDIS_URL && IORedis) return createRedisCache(process.env.REDIS_URL, fallback);
  return fallback;
}

function keyPart(value, fallback = 'all') {
  return encodeURIComponent(String(value || fallback).trim() || fallback);
}

export function rankingCacheKey({ tenantId = 'default', date = 'current', mealType = 'all' } = {}) {
  return `sc:v1:${keyPart(tenantId, 'default')}:ranking:${keyPart(date, 'current')}:${keyPart(mealType, 'all')}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value == null ? null : value;
}

export function dishSearchCacheKey({ tenantId = 'default', catalogRevision = '', viewerRole = 'anonymous', request = {} } = {}) {
  const payload = stableValue({ tenantId, catalogRevision, viewerRole, request });
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `sc:v1:${keyPart(tenantId, 'default')}:dish-search:${digest}`;
}
