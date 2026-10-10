import { useState } from 'react';
import { api, type Customer, type Emitter } from '../api';
import { NewCustomerForm } from '../components/NewCustomerForm';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Link,
  Modal,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
} from '../ui';

export function CustomersPage({ accountId }: { accountId: string }) {
  const base = `/api/accounts/${encodeURIComponent(accountId)}/customers`;
  const [q, setQ] = useState('');
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const customers = useAsync(() => api.get<Customer[]>(`${base}${query}`), [base, query, version]);
  const emitters = useAsync(
    () => api.get<Emitter[]>(`/api/accounts/${encodeURIComponent(accountId)}/emitters`),
    [accountId],
  );

  return (
    <Layout title="Clientes" accountId={accountId}>
      <Card className="flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1">
          <Field label="Pesquisar">
            <Input
              placeholder="Nome ou documento"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Novo cliente
        </Button>
      </Card>
      <Modal open={creating} title="Novo cliente" onClose={() => setCreating(false)}>
        {creating && (
          <NewCustomerForm
            accountId={accountId}
            emitters={emitters.data ?? []}
            onCreated={() => {
              setCreating(false);
              setVersion((v) => v + 1);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </Modal>
      {customers.error && <Alert variant="error">{errorText(customers.error)}</Alert>}
      {!customers.data && !customers.error && <Spinner />}
      {customers.data && (
        <Table>
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>Documento</TH>
              <TH>E-mail</TH>
              <TH>Origem</TH>
            </tr>
          </THead>
          <TBody>
            {customers.data.map((customer) => (
              <tr key={customer.id}>
                <TD>
                  <Link href={routeHref({ name: 'customer', accountId, customerId: customer.id })}>
                    {customer.name}
                  </Link>
                </TD>
                <TD>{customer.document ?? 'sem documento'}</TD>
                <TD>{customer.email}</TD>
                <TD>
                  <Badge variant={customer.origin === 'manual' ? 'info' : 'neutral'}>
                    {customer.origin === 'manual' ? 'manual' : 'importado'}
                  </Badge>
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Layout>
  );
}
