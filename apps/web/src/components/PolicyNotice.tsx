import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, Link } from '../ui';
import { useMe } from './MeContext';

// A policy update applies when published; the app shows it once, and the click is recorded.
export function PolicyNotice() {
  const me = useMe();
  const [hidden, setHidden] = useState(false);
  const notice = me?.policyNotice;
  if (!notice || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    void api.post('/api/me/policy-notice', { id: notice.id }).catch(() => {});
  };

  return (
    <Alert variant="info" className="flex flex-wrap items-center justify-between gap-3">
      <span>
        {notice.text}{' '}
        <Link href={notice.href} target="_blank" rel="noopener">
          Ler a política
        </Link>
      </span>
      <Button onClick={dismiss}>Entendi</Button>
    </Alert>
  );
}
