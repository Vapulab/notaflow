export interface RateLimiter {
  (key: string, now?: number): boolean;
  size(): number;
}

// In memory and per process, like the Better Auth counters.
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  sweepEvery?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  const sweepEvery = options.sweepEvery ?? 1000;
  let calls = 0;
  const allow = (key: string, now = Date.now()): boolean => {
    calls += 1;
    // A key never seen again would stay forever; drop the ones idle for a whole window.
    if (calls % sweepEvery === 0) {
      for (const [k, times] of hits) {
        const newest = times.at(-1);
        if (newest === undefined || newest <= now - options.windowMs) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((at) => at > now - options.windowMs);
    const allowed = recent.length < options.max;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    return allowed;
  };
  return Object.assign(allow, { size: () => hits.size });
}
