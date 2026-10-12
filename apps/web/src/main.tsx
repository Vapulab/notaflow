import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startAnalytics } from './analytics/analytics';
import { api } from './api';
import { startErrorTracking } from './observability/errors';
import type { PublicConfig } from './auth/PublicLayout';
import './index.css';

void api.get<PublicConfig>('/api/public/config').then(
  (config) => {
    void startErrorTracking(config.sentry ?? null);
    void startAnalytics(config.posthog ?? null);
  },
  () => {},
);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
