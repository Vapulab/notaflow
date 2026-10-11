import '../index.css';
import './site.css';
import { startAnalytics } from '../analytics/analytics';

// The public pages share the app's theme choice (the Malphas storage key) and its toggle.
const THEME_KEY = 'malphas-theme';

function isDark(): boolean {
  const chosen = document.documentElement.dataset.theme;
  if (chosen) return chosen === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
  button.addEventListener('click', () => {
    const theme = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Without storage the choice lasts until the page reloads.
    }
  });
}

// The public pages count visits like the app, with the same privacy options.
void fetch('/api/public/config')
  .then((response) => (response.ok ? response.json() : null))
  .then((config: { posthog?: { token: string; host: string } | null } | null) =>
    startAnalytics(config?.posthog ?? null),
  )
  .catch(() => {});
