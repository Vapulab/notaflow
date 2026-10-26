import { useEffect, useRef } from 'react';

// Calls `refresh` every `everyMs` while `active`; stops when inactive or unmounted.
export function usePolling(active: boolean, refresh: () => void, everyMs = 3000) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => latest.current(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
}
