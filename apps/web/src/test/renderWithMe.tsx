import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Me } from '../api';
import { MeContext } from '../components/MeContext';

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
