import { useEffect, useState } from 'react';

// False where matchMedia is missing (tests, old browsers): the desktop layout is the safe default.
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// Below Tailwind's sm breakpoint.
export const useIsPhone = () => useMediaQuery('(max-width: 639.98px)');
