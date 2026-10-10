import { type FormEvent, useState } from 'react';
import { ApiError, api, type Customer, type Emitter } from '../api';
import { Alert, Button, Field, Input, Select } from '../ui';
import { type AddressValue, AddressFields, emptyAddress, toPartyAddress } from './AddressFields';
import { errorText } from './Layout';

type Place = 'brazil' | 'abroad';
type Text = 'document' | 'name' | 'email' | 'phone' | 'municipalRegistration';

// A CNPJ may have letters (alphanumeric CNPJ); a CPF has digits only.
function documentDigits(type: 'CNPJ' | 'CPF', text: string): string {
  const clean = text.replace(/[.\-/\s]/g, '').toUpperCase();
  return type === 'CPF' ? clean.replace(/\D/g, '') : clean;
}

export function NewCustomerForm(props: {
  accountId: string;
  emitters: Emitter[];
  emitterId?: string; // fixed by the caller, as in "Nova nota"
  onCreated: (customer: Customer) => void;
  onCancel: () => void;
}) {
  const [emitterId, setEmitterId] = useState(props.emitterId ?? props.emitters[0]?.id ?? '');
  const [place, setPlace] = useState<Place | null>(null);
  const [documentType, setDocumentType] = useState<'CNPJ' | 'CPF'>('CNPJ');
  const [hasNif, setHasNif] = useState(true);
  const [text, setText] = useState<Record<Text, string>>({
    document: '',
    name: '',
    email: '',
    phone: '',
    municipalRegistration: '',
  });
  const [address, setAddress] = useState<AddressValue>(emptyAddress('domestic'));
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: Text) => (value: string) => setText((t) => ({ ...t, [field]: value }));
  const input = (field: Text, label: string, type = 'text') => (
    <Field label={label}>
      <Input type={type} value={text[field]} onChange={(e) => set(field)(e.target.value)} />
    </Field>
  );

  function choose(next: Place) {
    setPlace(next);
    setAddress(emptyAddress(next === 'brazil' ? 'domestic' : 'foreign'));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!place) return;
    setDocumentError(null);
    setError(null);
    const party = toPartyAddress(address);
    if (!party || !text.name.trim()) {
      setError('Preencha o nome e o endereço completo.');
      return;
    }
    const document =
      place === 'brazil'
        ? { documentType, document: documentDigits(documentType, text.document) }
        : hasNif
          ? { documentType: 'NIF' as const, document: text.document.trim() }
          : { documentType: 'NONE' as const };
    const optional = (field: Text) => (text[field].trim() ? { [field]: text[field].trim() } : {});
    setBusy(true);
    try {
      const customer = await api.post<Customer>(
        `/api/accounts/${encodeURIComponent(props.accountId)}/customers`,
        {
          emitterId,
          ...document,
          name: text.name.trim(),
          ...optional('email'),
          // The server takes the phone as digits only.
          ...(text.phone.trim() ? { phone: text.phone.replace(/\D/g, '') } : {}),
          ...(place === 'brazil' ? optional('municipalRegistration') : {}),
          address: party,
        },
      );
      props.onCreated(customer);
    } catch (failure) {
      const message = errorText(failure);
      if (failure instanceof ApiError && failure.code === 'invalid_document') {
        setDocumentError(message);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {!props.emitterId && props.emitters.length > 1 && (
        <Field label="Emitente">
          <Select value={emitterId} onChange={(e) => setEmitterId(e.target.value)}>
            {props.emitters.map((e) => (
              <option key={e.id} value={e.id}>
                {e.companyName}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="flex flex-wrap gap-6">
        <legend className="mb-2 text-sm font-medium text-fg">Onde está o cliente?</legend>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="radio"
            name="place"
            checked={place === 'brazil'}
            onChange={() => choose('brazil')}
          />
          Cliente no Brasil
        </label>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="radio"
            name="place"
            checked={place === 'abroad'}
            onChange={() => choose('abroad')}
          />
          Cliente no exterior
        </label>
      </fieldset>
      {place === 'brazil' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de documento">
            <Select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as 'CNPJ' | 'CPF')}
            >
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
            </Select>
          </Field>
          {input('document', documentType)}
        </div>
      )}
      {place === 'abroad' && (
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={hasNif} onChange={(e) => setHasNif(e.target.checked)} />
            O cliente tem NIF
          </label>
          {hasNif && input('document', 'NIF')}
        </div>
      )}
      {documentError && <Alert variant="error">{documentError}</Alert>}
      {place && (
        <>
          {input('name', 'Nome ou razão social')}
          <div className="grid gap-4 sm:grid-cols-3">
            {input('email', 'E-mail', 'email')}
            {input('phone', 'Telefone')}
            {place === 'brazil' && input('municipalRegistration', 'Inscrição municipal')}
          </div>
          <AddressFields accountId={props.accountId} value={address} onChange={setAddress} />
        </>
      )}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={!place || busy}>
          Cadastrar cliente
        </Button>
        <Button type="button" variant="secondary" onClick={props.onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
