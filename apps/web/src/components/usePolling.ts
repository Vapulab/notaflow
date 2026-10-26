import { useEffect, useRef } from 'react';

// Calls `refresh` every `everyMs` while `active`; a tick is skipped while the last fetch runs, so a slow API never discards its own answer.
export function usePolling(active: boolean, refresh: () => void, busy: boolean, everyMs = 3000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const running = useRef(busy);
  running.current = busy;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (!running.current) latest.current();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}
