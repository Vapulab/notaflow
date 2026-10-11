import { useEffect, useState } from 'react';
import { api } from '../api';

// Search results for a combobox, asked 300 ms after the last key.
// listWhenEmpty: an empty text asks the whole list, so the field shows what exists before any typing.
export function useSearch<T>(
  url: string,
  query: string,
  options: { listWhenEmpty?: boolean } = {},
): T[] {
  const { listWhenEmpty = false } = options;
  const [found, setFound] = useState<T[]>([]);
  useEffect(() => {
    const text = query.trim();
    if (!text && !listWhenEmpty) return;
    let live = true;
    const timer = setTimeout(() => {
      const joiner = url.includes('?') ? '&' : '?';
      api.get<T[]>(text ? `${url}${joiner}q=${encodeURIComponent(text)}` : url).then(
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
  }, [url, query, listWhenEmpty]);
  return query.trim() || listWhenEmpty ? found : [];
}
