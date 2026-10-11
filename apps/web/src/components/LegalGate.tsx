import { type ReactNode, useState } from 'react';
import { api } from '../api';
import { PublicLayout } from '../auth/PublicLayout';
import { Alert, Button, Link } from '../ui';
import { errorText } from './Layout';
import { useMe } from './MeContext';

// No screen of the app opens before the user accepts the current terms and privacy policy.
export function LegalGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!me || me.legalAccepted !== false || accepted) return <>{children}</>;
  const version = me.legalVersion;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/me/legal-acceptance', { version });
      setAccepted(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout title="Termos de uso e privacidade">
      <p className="text-sm text-fg">
        Para usar o NotaFlow, leia e aceite os documentos abaixo. Eles explicam o que o serviço faz,
        o que você e nós nos comprometemos a fazer, e como tratamos os seus dados.
      </p>
      {Boolean(error) && <Alert variant="error">{errorText(error)}</Alert>}
      <LegalCheckbox checked={checked} onChange={setChecked} />
      <Button variant="primary" disabled={!checked || busy} onClick={() => void accept()}>
        Continuar
      </Button>
    </PublicLayout>
  );
}

// The links open in a new tab, so the form keeps what was typed.
export function LegalCheckbox(props: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-fg">
      <input
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>
        Li e aceito os{' '}
        <Link href="/termos" target="_blank" rel="noopener">
          Termos de uso
        </Link>{' '}
        e a{' '}
        <Link href="/privacidade" target="_blank" rel="noopener">
          Política de privacidade
        </Link>
        .
      </span>
    </label>
  );
}
