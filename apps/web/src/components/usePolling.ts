import { useEffect, useRef } from 'react';

// Stops after this long, so a queue or worker outage does not keep every open screen hitting the API.
const MAX_POLLING_MS = 120_000;

// Calls `refresh` every `everyMs` while `active`; a tick is skipped while the last fetch runs, so a slow API never discards its own answer. After 2 minutes it stops until the screen mounts again.
export function usePolling(active: boolean, refresh: () => void, busy: boolean, everyMs = 3000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const running = useRef(busy);
  running.current = busy;
  useEffect(() => {
    if (!active) return;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += everyMs;
      if (!running.current) latest.current();
      if (elapsed >= MAX_POLLING_MS) clearInterval(timer);
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}
