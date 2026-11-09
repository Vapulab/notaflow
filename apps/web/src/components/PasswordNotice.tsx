import { useState } from 'react';
import { api } from '../api';
import { routeHref } from '../router';
import { Alert, Button, Link } from '../ui';
import { useMe } from './MeContext';

// Every screen mounts its own Layout, so the dismissal lives here; the next /api/me no longer has it.
let dismissed = false;

// A code login on an unconfirmed e-mail erased the signup password (Better Auth); the person must know.
export function PasswordNotice() {
  const me = useMe();
  const [hidden, setHidden] = useState(false);
  if (!me?.passwordRemoved || hidden || dismissed) return null;

  const dismiss = () => {
    dismissed = true;
    setHidden(true);
    void api.post('/api/me/password-notice', {}).catch(() => {});
  };

  return (
    <Alert variant="info" className="flex flex-wrap items-center justify-between gap-3">
      <span>
        Por segurança, a senha do cadastro foi apagada porque o e-mail ainda não tinha sido
        confirmado. Você continua entrando com código por e-mail.{' '}
        <Link href={routeHref({ name: 'profile' })}>Criar uma senha nova</Link>
      </span>
      <Button onClick={dismiss}>Entendi</Button>
    </Alert>
  );
}
