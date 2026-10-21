// In memory and per process, like the Better Auth counters.
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}): (key: string, now?: number) => boolean {
  const hits = new Map<string, number[]>();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((at) => at > now - options.windowMs);
    const allowed = recent.length < options.max;
    if (allowed) recent.push(now);
    if (recent.length > 0) hits.set(key, recent);
    else hits.delete(key);
    return allowed;
  };
}
