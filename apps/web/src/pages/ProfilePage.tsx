import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  addPasskey,
  deletePasskey,
  linkGoogle,
  listAccounts,
  listPasskeys,
  listSessions,
  requestReset,
  resetPassword,
  revokeSessions,
  unlinkAccount,
  updateName,
} from '../auth/authApi';
import { describeBrowser } from '../auth/browser';
import { CodeField } from '../auth/CodeField';
import { usePublicConfig } from '../auth/PublicLayout';
import { Turnstile } from '../auth/Turnstile';
import { errorText, Layout } from '../components/Layout';
import { useMe } from '../components/MeContext';
import { useAsync } from '../components/useAsync';
import { formatDateTime } from '../format';
import { navigate } from '../router';
import { Alert, Badge, Button, Field, FORM_CLASSES, Input, SECTION_TITLE_CLASSES } from '../ui';

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_TITLE_CLASSES}>{props.title}</h2>
      {props.children}
    </section>
  );
}

// Runs one action at a time per section and keeps its error.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorAlert({ error }: { error: unknown }) {
  return error ? <Alert variant="error">{errorText(error)}</Alert> : null;
}

export function ProfilePage() {
  const me = useMe();
  const config = usePublicConfig();
  const accounts = useAsync(listAccounts, []);
  const passkeys = useAsync(listPasskeys, []);
  const sessions = useAsync(listSessions, []);
  if (!me) return <Layout title="Minha conta">{null}</Layout>;
  const linked = accounts.data ?? [];
  return (
    <Layout title="Minha conta">
      <NameSection name={me.name} email={me.email} />
      <PasswordSection
        email={me.email}
        hasPassword={linked.some((a) => a.providerId === 'credential')}
        turnstileSiteKey={config.data?.turnstileSiteKey ?? null}
      />
      <Section title="Passkeys">
        <PasskeyList items={passkeys.data ?? []} reload={passkeys.reload} />
      </Section>
      {config.data?.googleEnabled && (
        <Section title="Google">
          <GoogleLink accounts={linked} reload={accounts.reload} />
        </Section>
      )}
      <Section title="Sessões ativas">
        <SessionList items={sessions.data ?? []} />
      </Section>
      <Section title="E-mails">
        <RemindersToggle initial={me.lifecycleEmails !== false} />
      </Section>
    </Layout>
  );
}

// The reminders of RFC_LIFECYCLE_EMAILS; service e-mails, such as login codes, always go.
function RemindersToggle(props: { initial: boolean }) {
  const [on, setOn] = useState(props.initial);
  const action = useAction();
  const change = (next: boolean) =>
    action.run(async () => {
      setOn(next);
      try {
        await api.put('/api/me/preferences', { lifecycleEmails: next });
      } catch (failure) {
        setOn(!next);
        throw failure;
      }
    });
  return (
    <>
      <label className="flex items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="mt-1"
          checked={on}
          disabled={action.busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>
          Receber lembretes e dicas por e-mail
          <span className="block text-muted">
            Ajuda para terminar o cadastro, emitir a primeira nota e voltar a usar o NotaFlow. Os
            e-mails de código de acesso continuam.
          </span>
        </span>
      </label>
      <ErrorAlert error={action.error} />
    </>
  );
}

function NameSection(props: { name: string; email: string }) {
  const [name, setName] = useState(props.name);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    void run(async () => {
      await updateName(name.trim());
      setSaved(true);
    });
  };
  return (
    <Section title="Seus dados">
      <ErrorAlert error={error} />
      {saved && <Alert variant="success">Nome salvo.</Alert>}
      <form className={FORM_CLASSES} onSubmit={submit}>
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <p className="text-sm text-muted">E-mail: {props.email}</p>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            Salvar nome
          </Button>
        </div>
      </form>
    </Section>
  );
}

// A password is created or changed with a code to the e-mail; afterwards every session ends.
function PasswordSection(props: {
  email: string;
  hasPassword: boolean;
  turnstileSiteKey: string | null;
}) {
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const onToken = useCallback((value: string | null) => setToken(value), []);
  const { busy, error, run } = useAction();
  const start = () =>
    run(async () => {
      await requestReset(props.email, token);
      setStep('code');
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await resetPassword(props.email, code, password);
      navigate('/entrar?volta=%2Fapp%2Fconta', { replace: true });
    });
  };
  return (
    <Section title="Senha">
      <ErrorAlert error={error} />
      {step === 'idle' ? (
        <>
          <p className="text-sm text-muted">
            {props.hasPassword
              ? 'Enviamos um código ao seu e-mail para confirmar a troca.'
              : 'Você entra com código ou Google. Uma senha é opcional.'}
          </p>
          {props.turnstileSiteKey && (
            <Turnstile siteKey={props.turnstileSiteKey} onToken={onToken} />
          )}
          <div>
            <Button disabled={busy || (!!props.turnstileSiteKey && !token)} onClick={start}>
              {props.hasPassword ? 'Alterar senha' : 'Criar senha'}
            </Button>
          </div>
        </>
      ) : (
        <form className={FORM_CLASSES} onSubmit={submit}>
          <CodeField value={code} onChange={setCode} />
          <Field label="Nova senha" hint="Pelo menos 10 caracteres. Depois, entre de novo.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Salvar senha
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function PasskeyList(props: {
  items: { id: string; name: string | null; createdAt: string }[];
  reload: () => void;
}) {
  const { busy, error, run } = useAction();
  const supported = typeof window.PublicKeyCredential !== 'undefined';
  return (
    <>
      <ErrorAlert error={error} />
      {props.items.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma passkey. Com uma, você entra sem senha nem código.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.items.map((item) => {
            const name = item.name ?? 'Passkey';
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  <span className="font-medium text-fg">{name}</span>{' '}
                  <span className="text-muted">criada em {formatDateTime(item.createdAt)}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Remover ${name}`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await deletePasskey(item.id);
                      props.reload();
                    })
                  }
                >
                  Remover
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await addPasskey(describeBrowser(navigator.userAgent));
              props.reload();
            })
          }
        >
          Adicionar passkey
        </Button>
        {!supported && (
          <p className="mt-1 text-xs text-muted">Este navegador não aceita passkeys.</p>
        )}
      </div>
    </>
  );
}

function GoogleLink(props: { accounts: { id: string; providerId: string }[]; reload: () => void }) {
  const { busy, error, run } = useAction();
  const google = props.accounts.find((a) => a.providerId === 'google');
  return (
    <>
      <ErrorAlert error={error} />
      {google ? (
        <>
          <p className="text-sm">Google vinculado.</p>
          {props.accounts.length > 1 ? (
            <div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await unlinkAccount(google.id);
                    props.reload();
                  })
                }
              >
                Desvincular Google
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">Crie uma senha antes de desvincular o Google.</p>
          )}
        </>
      ) : (
        <div>
          <Button disabled={busy} onClick={() => run(linkGoogle)}>
            Vincular Google
          </Button>
        </div>
      )}
    </>
  );
}

function SessionList(props: {
  items: {
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    updatedAt: string;
    current: boolean;
  }[];
}) {
  const { busy, error, run } = useAction();
  // The list loads once; a session that ends elsewhere still shows until the page reloads.
  const [items, setItems] = useState(props.items);
  useEffect(() => setItems(props.items), [props.items]);
  return (
    <>
      <ErrorAlert error={error} />
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-fg">{describeBrowser(item.userAgent)}</span>
            {item.ipAddress && <span className="text-muted">{item.ipAddress}</span>}
            <span className="text-muted">último uso {formatDateTime(item.updatedAt)}</span>
            {item.current && <Badge variant="info">Esta sessão</Badge>}
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await revokeSessions();
              navigate('/entrar', { replace: true });
            })
          }
        >
          Sair de todos os dispositivos
        </Button>
      </div>
    </>
  );
}
