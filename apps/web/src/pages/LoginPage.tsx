import { type FormEvent, useCallback, useState } from 'react';
import {
  sendCode,
  signInWithCode,
  signInWithGoogle,
  signInWithPasskey,
  signInWithPassword,
} from '../auth/authApi';
import { CodeField } from '../auth/CodeField';
import { PublicLayout, PublicLoading, usePublicConfig } from '../auth/PublicLayout';
import { Turnstile } from '../auth/Turnstile';
import { errorText } from '../components/Layout';
import { navigate } from '../router';
import { Alert, Button, Field, FORM_CLASSES, Input, Link } from '../ui';

// Only a path of the app itself: an outside or protocol-relative URL would be an open redirect.
export function safeDestination(volta: string | null): string {
  if (!volta || !volta.startsWith('/') || volta.startsWith('//') || volta.includes('\\')) {
    return '/app';
  }
  const path = volta.split(/[?#]/)[0] ?? '';
  const inside = ['/app', '/admin'].some((root) => path === root || path.startsWith(`${root}/`));
  return inside ? volta : '/app';
}

// The codes Better Auth puts in ?error= when Google sends the browser back.
const GOOGLE_ERROR: Record<string, string> = {
  account_not_linked:
    'Este e-mail já tem conta no NotaFlow. Entre com um código por e-mail e depois vincule o Google em Minha conta.',
  signup_closed: 'O cadastro de novas empresas abre em breve.',
};

export function LoginPage() {
  const config = usePublicConfig();
  const query = new URLSearchParams(window.location.search);
  const destination = safeDestination(query.get('volta'));
  const googleError = query.get('error');
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  if (!config.data) return <PublicLoading />;
  const { googleEnabled, turnstileSiteKey } = config.data;
  const passkeys = typeof window.PublicKeyCredential !== 'undefined';

  const run = async (action: () => Promise<void>, then?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      then?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const done = () => navigate(destination, { replace: true });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'password') return run(() => signInWithPassword(email, password), done);
    if (step === 'email') {
      return run(
        () => sendCode(email, 'sign-in', token),
        () => setStep('code'),
      );
    }
    return run(() => signInWithCode(email, code), done);
  };

  return (
    <PublicLayout title="Entrar no NotaFlow">
      {googleError && !error && (
        <Alert variant="error">
          {GOOGLE_ERROR[googleError] ??
            'Não foi possível entrar com o Google. Tente de novo ou use um código por e-mail.'}
        </Alert>
      )}
      {Boolean(error) && <Alert variant="error">{errorText(error)}</Alert>}
      <form className={FORM_CLASSES} onSubmit={submit}>
        {step === 'email' || mode === 'password' ? (
          <Field label="E-mail">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete={mode === 'password' ? 'username' : 'email'}
              required
            />
          </Field>
        ) : (
          <p className="text-sm text-muted">Enviamos um código para {email}.</p>
        )}
        {mode === 'password' && (
          <Field label="Senha">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
        )}
        {mode === 'code' && step === 'code' && <CodeField value={code} onChange={setCode} />}
        {mode === 'code' && step === 'email' && turnstileSiteKey && (
          <Turnstile siteKey={turnstileSiteKey} onToken={onToken} />
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || (mode === 'code' && step === 'email' && !!turnstileSiteKey && !token)}
        >
          {mode === 'code' && step === 'email' ? 'Enviar código' : 'Entrar'}
        </Button>
      </form>
      {mode === 'code' && step === 'code' && (
        <Link href="/entrar" onClick={() => setStep('email')}>
          Usar outro e-mail
        </Link>
      )}
      {step === 'email' && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {googleEnabled && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => signInWithGoogle(destination, '/entrar'))}
            >
              Entrar com Google
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMode(mode === 'code' ? 'password' : 'code');
            }}
          >
            {mode === 'code' ? 'Entrar com senha' : 'Receber código por e-mail'}
          </Button>
          {passkeys && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => run(signInWithPasskey, done)}
            >
              Entrar com passkey
            </Button>
          )}
        </div>
      )}
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/cadastro">Criar conta</Link>
        <Link href="/recuperar-senha" variant="muted">
          Esqueci minha senha
        </Link>
      </p>
    </PublicLayout>
  );
}
