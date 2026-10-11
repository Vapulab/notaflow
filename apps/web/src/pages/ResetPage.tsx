import { type FormEvent, useCallback, useState } from 'react';
import { requestReset, resetPassword } from '../auth/authApi';
import { CodeField } from '../auth/CodeField';
import { PublicLayout, PublicLoading, usePublicConfig } from '../auth/PublicLayout';
import { Turnstile } from '../auth/Turnstile';
import { errorText } from '../components/Layout';
import { Alert, Button, Field, FORM_CLASSES, Input, Link } from '../ui';

// Also creates the first password of a user who only ever logged in by code.
export function ResetPage() {
  const config = usePublicConfig();
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  if (!config.data) return <PublicLoading />;
  const { turnstileSiteKey } = config.data;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'email') {
        await requestReset(email, token);
        setStep('code');
      } else {
        await resetPassword(email, code, password);
        setStep('done');
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <PublicLayout title="Criar ou redefinir senha">
        <Alert variant="success">Senha salva. Entre com ela.</Alert>
        <Link href="/entrar">Entrar</Link>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout title="Criar ou redefinir senha">
      {Boolean(error) && <Alert variant="error">{errorText(error)}</Alert>}
      <form className={FORM_CLASSES} onSubmit={submit}>
        {step === 'email' ? (
          <>
            <Field label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} onToken={onToken} />}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || (!!turnstileSiteKey && !token)}
            >
              Enviar código
            </Button>
          </>
        ) : (
          <>
            <CodeField value={code} onChange={setCode} />
            <Field label="Nova senha" hint="Pelo menos 10 caracteres.">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy}>
              Salvar senha
            </Button>
          </>
        )}
      </form>
      <Link href="/entrar" variant="muted">
        Voltar para entrar
      </Link>
    </PublicLayout>
  );
}
