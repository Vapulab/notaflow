import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { api, ApiError, type Environment, type Me } from '../api';
import { navigate } from '../router';
import { useAsync } from './useAsync';

// Who is logged in, fetched once for the whole app. Null while loading or when unknown.
export const MeContext = createContext<Me | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  // No session: log in, then come back to this page.
  useEffect(() => {
    if (!signedOut) return;
    const here = window.location.pathname + window.location.search;
    navigate(`/entrar?volta=${encodeURIComponent(here)}`, { replace: true });
  }, [signedOut]);
  return <MeContext.Provider value={me.data ?? null}>{children}</MeContext.Provider>;
}

export function useMe(): Me | null {
  return useContext(MeContext);
}

export function isPlatformAdmin(me: Me | null): boolean {
  return me?.platformRole === 'admin';
}

export function roleIn(me: Me | null, accountId: string): 'owner' | 'member' | null {
  return me?.accounts.find((account) => account.id === accountId)?.role ?? null;
}

// Customers work in production only, so only the admin and test invoices need the environment named.
export function showsEnvironment(me: Me | null, environment: Environment): boolean {
  return environment === 'producao_restrita' || isPlatformAdmin(me);
}
