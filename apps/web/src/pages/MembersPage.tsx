import { type FormEvent, useState } from 'react';
import { api, type Member } from '../api';
import { Layout, errorText } from '../components/Layout';
import { roleIn, useMe } from '../components/MeContext';
import { useAsync } from '../components/useAsync';
import {
  Alert,
  Badge,
  Button,
  CARD_CLASSES,
  Card,
  Field,
  FORM_CLASSES,
  Input,
  SECTION_TITLE_CLASSES,
} from '../ui';

export function MembersPage({ accountId }: { accountId: string }) {
  const url = `/api/accounts/${encodeURIComponent(accountId)}/members`;
  const members = useAsync(() => api.get<Member[]>(url), [url]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      const answer = await api.post<{ emailSent?: boolean }>(url, { email, name });
      setMessage(
        answer.emailSent === false
          ? `${email} agora é membro da conta, mas o e-mail de convite não saiu. Avise a pessoa para entrar em ${window.location.host}/entrar com esse e-mail.`
          : `Convite enviado para ${email}. A pessoa entra com um código enviado para esse e-mail.`,
      );
      setEmail('');
      setName('');
      members.reload();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  const me = useMe();
  const role = roleIn(me, accountId);
  if (me && role !== 'owner') {
    return (
      <Layout title="Membros" accountId={accountId}>
        <Alert variant="info">Só o dono da conta gerencia os membros.</Alert>
      </Layout>
    );
  }

  return (
    <Layout title="Membros" accountId={accountId}>
      {members.error && <Alert variant="error">{errorText(members.error)}</Alert>}
      {members.data && (
        <Card>
          <ul className="flex flex-col gap-2">
            {members.data.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-fg">{member.name}</span>
                <span className="text-muted">{member.email}</span>
                <Badge>{member.role === 'owner' ? 'dono' : 'membro'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <form onSubmit={invite} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
        <h2 className={SECTION_TITLE_CLASSES}>Convidar membro</h2>
        <Field label="E-mail">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Nome">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" variant="primary">
            Convidar
          </Button>
        </div>
        {message && <Alert variant="info">{message}</Alert>}
      </form>
    </Layout>
  );
}
