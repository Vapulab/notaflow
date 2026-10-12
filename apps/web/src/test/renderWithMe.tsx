import { render } from '@testing-library/react';
import { type ReactNode, useCallback, useState } from 'react';
import type { Me } from '../api';
import { MeContext, MePatchContext } from '../components/MeContext';

export function meFor(platformRole: 'admin' | 'user', role: 'owner' | 'member' = 'owner'): Me {
  return {
    userId: 'u1',
    email: 'pessoa@example.com',
    name: 'Pessoa',
    platformRole,
    accounts: [{ id: 'acc', name: 'A', role, status: 'active', onboardingStep: 'done' }],
  };
}

// Renders a screen as a given user, as the MeProvider of the app would.
export function renderWithMe(ui: ReactNode, me: Me | null) {
  return render(<MeContext.Provider value={me}>{ui}</MeContext.Provider>);
}

// Like MeProvider: holds the user and applies patches, so a screen can leave and come back.
export function PatchableMe(props: { me: Me; children: ReactNode }) {
  const [me, setMe] = useState(props.me);
  const patch = useCallback(
    (change: Partial<Me>) => setMe((current) => ({ ...current, ...change })),
    [],
  );
  return (
    <MePatchContext.Provider value={patch}>
      <MeContext.Provider value={me}>{props.children}</MeContext.Provider>
    </MePatchContext.Provider>
  );
}
