import { type FormEvent, useEffect, useState } from 'react';
import { type AdminAccount, type AdminUser, api, type AuditEntry } from '../api';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { formatDateTime } from '../format';
import {
  Alert,
  Badge,
  Button,
  CARD_CLASSES,
  Combobox,
  type ComboboxOption,
  LABEL_CLASSES,
  Card,
  Field,
  FORM_CLASSES,
  Input,
  SECTION_TITLE_CLASSES,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
} from '../ui';

type Act = (action: () => Promise<string>) => Promise<void>;

export function AdminPage() {
  const accounts = useAsync(() => api.get<AdminAccount[]>('/api/admin/accounts'), []);
  const audit = useAsync(() => api.get<AuditEntry[]>('/api/admin/audit?limit=100'), []);
  const people = useAsync(() => api.get<AdminUser[]>('/api/admin/users'), []);
  const [message, setMessage] = useState<string | null>(null);

  const act: Act = async (action) => {
    try {
      setMessage(await action());
      accounts.reload();
      audit.reload();
      people.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  function toggle(account: AdminAccount) {
    void act(async () => {
      const status = account.status === 'active' ? 'suspended' : 'active';
      await api.post(`/api/admin/accounts/${encodeURIComponent(account.id)}/status`, { status });
      return status === 'suspended' ? `${account.name} suspensa.` : `${account.name} reativada.`;
    });
  }

  return (
    <Layout title="Painel do administrador">
      {message && <Alert variant="info">{message}</Alert>}
      {accounts.error && <Alert variant="error">{errorText(accounts.error)}</Alert>}
      <Table>
        <THead>
          <tr>
            <TH>Conta</TH>
            <TH>Situação</TH>
            <TH>Membros</TH>
            <TH>Id</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {accounts.data?.map((account) => (
            <tr key={account.id}>
              <TD>{account.name}</TD>
              <TD>
                <Badge variant={account.status === 'active' ? 'success' : 'warning'}>
                  {account.status === 'active' ? 'Ativa' : 'Suspensa'}
                </Badge>
              </TD>
              <TD>{account.members}</TD>
              <TD>
                <code className="font-mono text-xs">{account.id}</code>
              </TD>
              <TD>
                <Button size="sm" variant="secondary" onClick={() => toggle(account)}>
                  {account.status === 'active' ? 'Suspender' : 'Reativar'}
                </Button>
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
      <Card>
        <section>
          <h2 className={SECTION_TITLE_CLASSES}>Usuários</h2>
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>E-mail</TH>
                <TH>Papel</TH>
                <TH>Último acesso</TH>
              </tr>
            </THead>
            <TBody>
              {people.data?.map((person) => (
                <tr key={person.id}>
                  <TD>{person.name}</TD>
                  <TD>{person.email}</TD>
                  <TD>
                    <Badge variant={person.platformRole === 'admin' ? 'primary' : 'neutral'}>
                      {person.platformRole === 'admin' ? 'admin' : 'usuário'}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {person.lastLoginAt ? formatDateTime(person.lastLoginAt) : 'nunca'}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </section>
      </Card>
      <NewAccountForm act={act} />
      <NewUserForm act={act} />
      <SetMemberForm act={act} accounts={accounts.data ?? []} />
      <FailedMail />
      <Waitlist />
      <Card>
        <h2 className={SECTION_TITLE_CLASSES}>Auditoria (últimas 100)</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {audit.data?.map((entry) => (
            <li key={entry.id}>
              {formatDateTime(entry.at)} {entry.userEmail}: {entry.action} {entry.entity} (
              {entry.result}){entry.detail && ` ${entry.detail}`}
            </li>
          ))}
        </ul>
      </Card>
    </Layout>
  );
}

function NewAccountForm({ act }: { act: Act }) {
  const [name, setName] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/accounts', { name });
      setName('');
      return `Conta criada: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>Nova conta</h2>
      <Field label="Nome">
        <Input required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" variant="primary">
          Criar conta
        </Button>
      </div>
    </form>
  );
}

function NewUserForm({ act }: { act: Act }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const { id } = await api.post<{ id: string }>('/api/admin/users', {
        email,
        name,
        ...(admin ? { platformRole: 'admin' } : {}),
      });
      setEmail('');
      setName('');
      return `Usuário criado: ${id}`;
    });
  }
  return (
    <form onSubmit={submit} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>Novo usuário</h2>
      <Field label="E-mail">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Nome">
        <Input required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <label className="flex items-center text-sm text-fg">
        <input
          className="mr-2 accent-primary"
          type="checkbox"
          checked={admin}
          onChange={(e) => setAdmin(e.target.checked)}
        />{' '}
        Administrador da plataforma
      </label>
      <div>
        <Button type="submit" variant="primary">
          Criar usuário
        </Button>
      </div>
    </form>
  );
}

function SetMemberForm({ act, accounts }: { act: Act; accounts: AdminAccount[] }) {
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<AdminUser[]>([]);
  const [chosen, setChosen] = useState<ComboboxOption | null>(null);
  const [role, setRole] = useState<'owner' | 'member'>('owner');

  // Searches as the admin types, after a short pause.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
      api.get<AdminUser[]>(`/api/admin/users${query}`).then(
        (users) => {
          if (!live) return;
          setFound(users);
        },
        () => {
          if (live) setFound([]);
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const account = accounts.find((a) => a.id === accountId);
    if (!chosen) return;
    const userId = chosen.value;
    const person = found.find((u) => u.id === userId);
    void act(async () => {
      await api.put(
        `/api/admin/accounts/${encodeURIComponent(accountId)}/members/${encodeURIComponent(userId)}`,
        { role },
      );
      return `${person?.name ?? 'Usuário'} agora é ${role === 'owner' ? 'dono' : 'membro'} de ${account?.name ?? 'a conta'}.`;
    });
  }
  return (
    <form onSubmit={submit} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <h2 className={SECTION_TITLE_CLASSES}>Vincular usuário a uma conta</h2>
      <Field label="Conta">
        <Select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Escolha a conta
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-1">
        <span className={LABEL_CLASSES}>Usuário</span>
        <Combobox
          label="Usuário"
          query={search}
          onQueryChange={setSearch}
          options={found.map((person) => ({
            value: person.id,
            label: `${person.name} (${person.email})`,
          }))}
          selected={chosen}
          onSelect={setChosen}
          placeholder="Digite o nome ou o e-mail"
          emptyText="Nenhum usuário encontrado"
        />
      </div>
      <Field label="Papel">
        <Select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'member')}>
          <option value="owner">Dono</option>
          <option value="member">Membro</option>
        </Select>
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={!accountId || !chosen}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

interface FailedMailRow {
  id: number;
  kind: 'code' | 'invite' | 'welcome' | 'notice';
  to: string;
  subject: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

// The outbox gave up on these after its retries; a login code is useless once expired.
function FailedMail() {
  const failed = useAsync(() => api.get<FailedMailRow[]>('/api/admin/mail/failed'), []);
  const [message, setMessage] = useState<string | null>(null);

  async function retry(id: number) {
    try {
      const answer = await api.post<{ sent: boolean }>(`/api/admin/mail/${id}/retry`, {});
      setMessage(
        answer.sent ? 'E-mail reenviado.' : 'O reenvio falhou de novo. Ele volta para a fila.',
      );
      failed.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <Card>
      <section aria-labelledby="failed-mail" className="flex flex-col gap-3">
        <h2 id="failed-mail" className={SECTION_TITLE_CLASSES}>
          E-mails não entregues
        </h2>
        {message && <Alert variant="info">{message}</Alert>}
        {failed.data?.length === 0 && (
          <p className="text-sm text-muted">Nenhum. Tudo foi entregue.</p>
        )}
        {failed.data && failed.data.length > 0 && (
          <Table>
            <THead>
              <tr>
                <TH>Para</TH>
                <TH>Assunto</TH>
                <TH>Tentativas</TH>
                <TH>Último erro</TH>
                <TH>Criado em</TH>
                <TH>Ação</TH>
              </tr>
            </THead>
            <TBody>
              {failed.data.map((row) => (
                <tr key={row.id}>
                  <TD>{row.to}</TD>
                  <TD>{row.subject}</TD>
                  <TD>{row.attempts}</TD>
                  <TD>{row.lastError ?? ''}</TD>
                  <TD>{formatDateTime(row.createdAt)}</TD>
                  <TD>
                    {row.kind === 'code' ? (
                      <span className="text-sm text-muted">Código expirado, não se reenvia</span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => void retry(row.id)}>
                        Reenviar
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </Card>
  );
}

interface WaitlistSignup {
  id: string;
  email: string;
  interests: WaitlistInterest[];
  sourcePage: string;
  createdAt: string;
}

type WaitlistInterest = 'mei' | 'lucro_presumido' | 'certificate';

const INTEREST_LABEL: Record<WaitlistInterest, string> = {
  mei: 'MEI',
  lucro_presumido: 'Lucro presumido',
  certificate: 'Certificado A1',
};

// The notify-me list of the guide; the policy promises removal on request.
function Waitlist() {
  const list = useAsync(
    () =>
      api.get<{ signups: WaitlistSignup[]; counts: Record<WaitlistInterest, number> }>(
        '/api/admin/waitlist',
      ),
    [],
  );
  const [message, setMessage] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  async function remove(signup: WaitlistSignup) {
    if (removing || !window.confirm(`Remover ${signup.email} da lista de espera?`)) return;
    setMessage(null);
    setRemoving(true);
    try {
      await api.delete(`/api/admin/waitlist/${encodeURIComponent(signup.id)}`);
      setMessage({ variant: 'info', text: `${signup.email} removido.` });
      list.reload();
    } catch (error) {
      setMessage({ variant: 'error', text: errorText(error) });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <section aria-labelledby="waitlist" className="flex flex-col gap-3">
        <h2 id="waitlist" className={SECTION_TITLE_CLASSES}>
          Lista de espera
        </h2>
        {message && <Alert variant={message.variant}>{message.text}</Alert>}
        {list.error && <Alert variant="error">{errorText(list.error)}</Alert>}
        {list.data && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {(Object.keys(INTEREST_LABEL) as WaitlistInterest[]).map((interest) => (
              <li key={interest}>
                <Badge variant="neutral">{`${INTEREST_LABEL[interest]}: ${list.data?.counts[interest] ?? 0}`}</Badge>
              </li>
            ))}
          </ul>
        )}
        {list.data?.signups.length === 0 && <p className="text-sm text-muted">Ninguém ainda.</p>}
        {list.data && list.data.signups.length > 0 && (
          <Table>
            <THead>
              <tr>
                <TH>E-mail</TH>
                <TH>Interesses</TH>
                <TH>Página</TH>
                <TH>Em</TH>
                <TH>Ação</TH>
              </tr>
            </THead>
            <TBody>
              {list.data.signups.map((signup) => (
                <tr key={signup.id}>
                  <TD>{signup.email}</TD>
                  <TD>{signup.interests.map((i) => INTEREST_LABEL[i]).join(', ')}</TD>
                  <TD>{signup.sourcePage}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(signup.createdAt)}</TD>
                  <TD>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={removing}
                      onClick={() => void remove(signup)}
                    >
                      Remover
                    </Button>
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </Card>
  );
}
