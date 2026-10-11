import { useEffect, useRef } from 'react';

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'auto';
      language: string;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

// One script for the whole app, loaded the first time a form needs it.
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error()));
    script.onerror = () => reject(new Error('Turnstile did not load'));
    document.head.appendChild(script);
  });
  return loading;
}

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
