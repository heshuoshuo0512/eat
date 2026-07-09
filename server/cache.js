let IORedis;
try {
  const mod = await import('ioredis');
  IORedis = mod.default || mod;
} catch {
  IORedis = null;
}

function createMemoryCache() {
  const memory = new Map();
  const maxEntries = 500;

  function sweepExpired() {
    const current = Date.now();
    for (const [key, entry] of memory) {
      if (entry.expiresAt && entry.expiresAt < current) memory.delete(key);
    }
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  return {
    get(key) {
      const entry = memory.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        memory.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value, ttlMs = 30_000) {
      sweepExpired();
      memory.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    del(key) {
      memory.delete(key);
    }
  };
}

function createRedisCache(url) {
  const client = new IORedis(url, { lazyConnect: true });
  // Connect lazily — ioredis queues commands until ready
  client.connect().catch(() => {});

  return {
    async get(key) {
      const raw = await client.get(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async set(key, value, ttlMs = 30_000) {
      await client.set(key, JSON.stringify(value), 'PX', ttlMs);
    },
    async del(key) {
      await client.del(key);
    }
  };
}

export function createCache() {
  if (process.env.REDIS_URL && IORedis) {
    try {
      return createRedisCache(process.env.REDIS_URL);
    } catch {
      // Redis connection failed, fall through to memory
    }
  }
  return createMemoryCache();
}

export const rankingCacheKey = 'rankings:v1';
