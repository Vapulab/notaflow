import { useEffect, useRef } from 'react';
import { loadTurnstile } from './turnstileScript';

export function Turnstile(props: { siteKey: string; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { siteKey, onToken } = props;
  useEffect(() => {
    let widget: string | null = null;
    let live = true;
    loadTurnstile().then(
      (api) => {
        if (!live || !box.current) return;
        widget = api.render(box.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
          theme: 'auto',
          language: 'pt-br',
        });
      },
      () => onToken(null),
    );
    return () => {
      live = false;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, onToken]);
  return <div ref={box} />;
}
