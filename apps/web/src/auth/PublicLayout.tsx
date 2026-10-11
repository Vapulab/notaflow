import type { ReactNode } from 'react';
import { api } from '../api';
import { useAsync } from '../components/useAsync';
import { Card, Spinner, ThemeToggle } from '../ui';

export interface PublicConfig {
  googleEnabled: boolean;
  turnstileSiteKey: string | null;
  signupOpen: boolean;
}

export function usePublicConfig() {
  return useAsync(() => api.get<PublicConfig>('/api/public/config'), []);
}

// The pages before a session: no menu, the theme toggle, and one card in the middle.
export function PublicLayout(props: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <a href="/" className="font-display text-lg font-semibold text-primary">
          NotaFlow
        </a>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-md px-4 pb-12">
        <Card className="flex flex-col gap-5">
          <h1 className="font-display text-2xl font-semibold text-fg">{props.title}</h1>
          {props.children}
        </Card>
      </main>
    </div>
  );
}

export function PublicLoading() {
  return (
    <PublicLayout title="NotaFlow">
      <Spinner />
    </PublicLayout>
  );
}
