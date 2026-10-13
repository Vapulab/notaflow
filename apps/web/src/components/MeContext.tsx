import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, type Environment, type Me } from '../api';
import { identifyUser, track } from '../analytics/analytics';
import { takeGoogleSignup } from '../analytics/source';
import { navigate } from '../router';
import { useAsync } from './useAsync';

// Who is logged in, fetched once for the whole app. Null while loading or when unknown.
export const MeContext = createContext<Me | null>(null);
// A screen that changes a field of /api/me patches it here, so the next screen sees the change.
export const MePatchContext = createContext<(patch: Partial<Me>) => void>(() => {});

export function MeProvider({ children }: { children: ReactNode }) {
  const me = useAsync(() => api.get<Me>('/api/me'), []);
  const [patched, setPatched] = useState<Partial<Me>>({});
  const patch = useCallback(
    (change: Partial<Me>) => setPatched((current) => ({ ...current, ...change })),
    [],
  );
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  const userId = me.data?.userId;
  useEffect(() => {
    if (!userId) return;
    identifyUser(userId);
    // After identify, so the signup counts for the user and not for an anonymous visitor.
    const googleSignup = takeGoogleSignup();
    if (googleSignup) track('signup_completed', googleSignup);
  }, [userId]);
  // No session: log in, then come back to this page.
  useEffect(() => {
    if (!signedOut) return;
    const here = window.location.pathname + window.location.search;
    navigate(`/entrar?volta=${encodeURIComponent(here)}`, { replace: true });
  }, [signedOut]);
  return (
    <MePatchContext.Provider value={patch}>
      <MeContext.Provider value={me.data ? { ...me.data, ...patched } : null}>
        {children}
      </MeContext.Provider>
    </MePatchContext.Provider>
  );
}

export function useMe(): Me | null {
  return useContext(MeContext);
}

export function usePatchMe(): (patch: Partial<Me>) => void {
  return useContext(MePatchContext);
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
