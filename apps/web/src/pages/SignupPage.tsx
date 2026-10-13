import { type FormEvent, useCallback, useState } from 'react';
import { signUpWithPassword, verifyEmail } from '../auth/authApi';
import { CodeField } from '../auth/CodeField';
import { PublicLayout, PublicLoading, usePublicConfig } from '../auth/PublicLayout';
import { Turnstile } from '../auth/Turnstile';
import { track } from '../analytics/analytics';
import { api, type Me } from '../api';
import { LegalCheckbox } from '../components/LegalGate';
import { errorText } from '../components/Layout';
import { navigate } from '../router';
import { Alert, Button, Field, FORM_CLASSES, Input, Link } from '../ui';

// The box checked on the form becomes the record once the account exists; if this fails, the app asks again.
async function recordAcceptance() {
  try {
    const me = await api.get<Me>('/api/me');
    if (me.legalVersion) await api.post('/api/me/legal-acceptance', { version: me.legalVersion });
  } catch {
    // The acceptance screen of the app covers it.
  }
}

export function SignupPage() {
  const config = usePublicConfig();
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [legal, setLegal] = useState(false);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  if (!config.data) return <PublicLoading />;
  const { signupOpen, turnstileSiteKey } = config.data;

  if (!signupOpen) {
    return (
      <PublicLayout title="Criar conta">
        <Alert variant="info">O cadastro de novas empresas abre em breve.</Alert>
        <p className="text-sm">
          Já tem acesso? <Link href="/entrar">Entrar</Link>
        </p>
      </PublicLayout>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'form') {
        await signUpWithPassword(name, email, password, token);
        setStep('code');
      } else {
        await verifyEmail(email, code);
        await recordAcceptance();
        track('signup_completed');
        navigate('/app', { replace: true });
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout title="Criar conta">
      {Boolean(error) && <Alert variant="error">{errorText(error)}</Alert>}
      <form className={FORM_CLASSES} onSubmit={submit}>
        {step === 'form' ? (
          <>
            <Field label="Nome">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Senha" hint="Pelo menos 10 caracteres.">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </Field>
            <LegalCheckbox checked={legal} onChange={setLegal} />
            {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={onToken} />}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !legal || (!!turnstileSiteKey && !token)}
            >
              Criar conta
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Enviamos um código para {email}. Digite-o para confirmar o e-mail.
            </p>
            <p className="text-xs text-muted">
              Se este e-mail já tinha conta, enviamos instruções para entrar em vez do código.
            </p>
            <CodeField value={code} onChange={setCode} />
            <Button type="submit" variant="primary" disabled={busy}>
              Confirmar e-mail
            </Button>
            <p className="text-xs text-muted">
              Não chegou em alguns minutos? Olhe o spam e confira se o e-mail está certo.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                // A Turnstile token is good for one request; the form shows a new widget.
                setToken(null);
                setCode('');
                setError(null);
                setStep('form');
              }}
            >
              Corrigir e-mail
            </Button>
          </>
        )}
      </form>
      <p className="text-sm">
        Prefere entrar sem senha, só com um código por e-mail? <Link href="/entrar">Entrar</Link>
      </p>
    </PublicLayout>
  );
}
