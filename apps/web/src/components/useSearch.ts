import { useEffect, useState } from 'react';
import { api } from '../api';

// Search results for a combobox, asked 300 ms after the last key.
export function useSearch<T>(url: string, query: string): T[] {
  const [found, setFound] = useState<T[]>([]);
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    let live = true;
    const timer = setTimeout(() => {
      const joiner = url.includes('?') ? '&' : '?';
      api.get<T[]>(`${url}${joiner}q=${encodeURIComponent(text)}`).then(
        (items) => {
          if (live) setFound(items);
        },
        () => {
          if (live) setFound([]);
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, query]);
  return query.trim() ? found : [];
}
