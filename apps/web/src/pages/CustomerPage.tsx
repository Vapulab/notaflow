import { type FormEvent, useState } from 'react';
import { api, type Customer } from '../api';
import {
  type AddressValue,
  AddressFields,
  addressFromParty,
  toPartyAddress,
} from '../components/AddressFields';
import { Layout, errorText } from '../components/Layout';
import { useAsync } from '../components/useAsync';
import { routeHref } from '../router';
import {
  Alert,
  Button,
  buttonClasses,
  CARD_CLASSES,
  Field,
  FORM_CLASSES,
  Input,
  Link,
  SECTION_TITLE_CLASSES,
  Spinner,
} from '../ui';

type Text = 'name' | 'email' | 'phone' | 'municipalRegistration';

export function CustomerPage(props: { accountId: string; customerId: string }) {
  const url = `/api/accounts/${encodeURIComponent(props.accountId)}/customers/${encodeURIComponent(props.customerId)}`;
  const customer = useAsync(() => api.get<Customer>(url), [url]);
  return (
    <Layout title={customer.data?.name ?? 'Cliente'} accountId={props.accountId}>
      <Link href={routeHref({ name: 'customers', accountId: props.accountId })} variant="muted">
        Voltar para os clientes
      </Link>
      {customer.data && (
        <div>
          <Link
            className={buttonClasses({ variant: 'primary' })}
            href={routeHref({
              name: 'newInvoice',
              accountId: props.accountId,
              customerId: props.customerId,
            })}
          >
            Emitir nota
          </Link>
        </div>
      )}
      {customer.error && <Alert variant="error">{errorText(customer.error)}</Alert>}
      {!customer.data && !customer.error && <Spinner />}
      {customer.data && (
        <CustomerForm accountId={props.accountId} url={url} customer={customer.data} />
      )}
    </Layout>
  );
}

function CustomerForm(props: { accountId: string; url: string; customer: Customer }) {
  const { accountId, url, customer } = props;
  const [text, setText] = useState<Record<Text, string>>({
    name: customer.name,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    municipalRegistration: customer.municipalRegistration ?? '',
  });
  // The document decides the kind: a CNPJ or CPF lives in Brazil, a NIF or no document abroad.
  const kind =
    customer.documentType === 'CNPJ' || customer.documentType === 'CPF' ? 'domestic' : 'foreign';
  const [initialAddress] = useState(() => addressFromParty(customer.address, kind));
  const [address, setAddress] = useState<AddressValue>(initialAddress);
  const [message, setMessage] = useState<{ variant: 'info' | 'error'; text: string } | null>(null);

  function changes(): Record<string, unknown> | null {
    const body: Record<string, unknown> = {};
    for (const field of ['name', 'email', 'phone', 'municipalRegistration'] as const) {
      const value = text[field].trim();
      if (value && value !== ((customer[field] as string | null) ?? '')) body[field] = value;
    }
    if (JSON.stringify(address) !== JSON.stringify(initialAddress)) {
      const party = toPartyAddress(address);
      if (!party) return null;
      if (JSON.stringify(party) !== JSON.stringify(customer.address)) body.address = party;
    }
    return body;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const body = changes();
    if (body === null) {
      setMessage({ variant: 'error', text: 'Endereço incompleto.' });
      return;
    }
    if (Object.keys(body).length === 0) {
      setMessage({ variant: 'info', text: 'Nada mudou.' });
      return;
    }
    try {
      await api.put(url, body);
      setMessage({
        variant: 'info',
        text: 'Dados salvos. O sync não sobrescreve campos editados à mão.',
      });
    } catch (error) {
      setMessage({ variant: 'error', text: errorText(error) });
    }
  }

  const textField = (field: Text, label: string, type = 'text') => (
    <Field label={label}>
      <Input
        type={type}
        value={text[field]}
        onChange={(e) => setText((t) => ({ ...t, [field]: e.target.value }))}
      />
    </Field>
  );
  return (
    <form onSubmit={save} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
      <p className="text-sm text-muted">
        {customer.documentType} {customer.document ?? ''}
      </p>
      {textField('name', 'Nome')}
      {textField('email', 'E-mail', 'email')}
      {textField('phone', 'Telefone')}
      {textField('municipalRegistration', 'Inscrição municipal')}
      <h2 className={SECTION_TITLE_CLASSES}>Endereço</h2>
      <AddressFields accountId={accountId} value={address} onChange={setAddress} />
      {message && <Alert variant={message.variant}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary">
          Salvar
        </Button>
      </div>
    </form>
  );
}
