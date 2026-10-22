import '../index.css';
import './site.css';
import { startAnalytics } from '../analytics/analytics';
import { carryCampaign } from '../analytics/source';
import { startErrorTracking } from '../observability/errors';
import { publicConfig } from './publicConfig';

carryCampaign(document, window.location.search);

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

// The public pages count visits and report errors like the app, with the same privacy options.
void publicConfig().then((config) => {
  void startErrorTracking(config?.sentry ?? null);
  void startAnalytics(config?.posthog ?? null);
});
