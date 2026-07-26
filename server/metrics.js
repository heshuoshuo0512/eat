import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function createRuntimeMetrics({ maxLatencySamples = 2_000 } = {}) {
  const startedAt = Date.now();
  const latencySamples = [];
  const statuses = new Map();
  let requests = 0;
  let inFlight = 0;
  let errors = 0;
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  function beginRequest() {
    const start = performance.now();
    requests += 1;
    inFlight += 1;
    let finished = false;
    return (statusCode = 500) => {
      if (finished) return;
      finished = true;
      inFlight = Math.max(0, inFlight - 1);
      if (statusCode >= 500) errors += 1;
      statuses.set(statusCode, Number(statuses.get(statusCode) || 0) + 1);
      latencySamples.push(performance.now() - start);
      if (latencySamples.length > maxLatencySamples) latencySamples.splice(0, latencySamples.length - maxLatencySamples);
    };
  }

  function snapshot({ db = null, cache = null, outbox = null } = {}) {
    const sorted = [...latencySamples].sort((a, b) => a - b);
    const uptimeSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    return {
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(uptimeSeconds),
        memory: process.memoryUsage()
      },
      http: {
        requests,
        inFlight,
        errors,
        requestsPerSecond: Number((requests / uptimeSeconds).toFixed(3)),
        latencyMs: {
          p50: Number(percentile(sorted, 0.5).toFixed(2)),
          p95: Number(percentile(sorted, 0.95).toFixed(2)),
          p99: Number(percentile(sorted, 0.99).toFixed(2))
        },
        statuses: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b))
      },
      eventLoop: {
        meanMs: Number((Number(eventLoop.mean || 0) / 1e6).toFixed(2)),
        p95Ms: Number((Number(eventLoop.percentile(95) || 0) / 1e6).toFixed(2)),
        maxMs: Number((Number(eventLoop.max || 0) / 1e6).toFixed(2))
      },
      database: db?.pool ? {
        total: Number(db.pool.totalCount || 0),
        idle: Number(db.pool.idleCount || 0),
        waiting: Number(db.pool.waitingCount || 0),
        max: Number(db.pool.options?.max || 0)
      } : { driver: 'sqlite' },
      cache: cache || null,
      outbox: outbox || null
    };
  }

  async function waitForIdle(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return inFlight === 0;
  }

  return {
    beginRequest,
    snapshot,
    waitForIdle,
    close() { eventLoop.disable(); },
    get inFlight() { return inFlight; }
  };
}
