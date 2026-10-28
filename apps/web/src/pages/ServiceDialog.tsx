import { ibsCbsDefaults } from '@notaflow/provider-nacional/simples';
import { type FormEvent, useState } from 'react';
import { api, type Service, type ServiceCode, type ServiceExport, type ServiceInput } from '../api';
import { errorText } from '../components/Layout';
import { SUGGESTED_HEADING, useSuggestedCodes } from '../components/suggestedCodes';
import { useSearch } from '../components/useSearch';
import { EXPORT_LABELS, EXPORT_OPTIONS } from '../exportCodes';
import { formatServiceCode } from '../format';
import {
  Alert,
  Button,
  Combobox,
  type ComboboxOption,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from '../ui';

type Text =
  | 'name'
  | 'description'
  | 'municipalTaxCode'
  | 'nbsCode'
  | 'pisCofinsCst'
  | 'operationCode'
  | 'cst'
  | 'classCode';
type ExportField = keyof ServiceExport;
const EXPORT_FIELDS: ExportField[] = [
  'mode',
  'providerLink',
  'providerSupport',
  'customerSupport',
  'temporaryGoods',
  'mdic',
];

const codeOption = (c: ServiceCode): ComboboxOption => ({
  value: c.code,
  label: c.description
    ? `${formatServiceCode(c.code)} – ${c.description}`
    : formatServiceCode(c.code),
});

// The stored codes of the service, else the Anexo VIII defaults of the code.
function ibsCbsOf(service: Service | null, code: string | undefined) {
  if (service?.ibsCbs) return service.ibsCbs;
  // The codes of a service with export details are export codes: no Brazil defaults there.
  return code && !service?.export ? ibsCbsDefaults(code) : null;
}

function textOf(service: Service | null, code?: string): Record<Text, string> {
  const ibsCbs = ibsCbsOf(service, service?.nationalTaxCode ?? code);
  return {
    name: service?.name ?? '',
    description: service?.description ?? '',
    municipalTaxCode: service?.municipalTaxCode ?? '',
    nbsCode: service?.nbsCode ?? '',
    pisCofinsCst: service?.pisCofinsCst ?? '',
    operationCode: ibsCbs?.operationCode ?? '',
    cst: ibsCbs?.cst ?? '',
    classCode: ibsCbs?.classCode ?? '',
  };
}

// The body of POST services or PUT services/:id: optional groups go only when every field is filled.
// Codes equal to the Anexo VIII defaults stay out, so a table update still reaches the service.
const isKept = (kept: Service['ibsCbs'], text: Record<Text, string>) =>
  kept?.operationCode === text.operationCode.trim() &&
  kept.cst === text.cst.trim() &&
  kept.classCode === text.classCode.trim();

export function serviceBody(
  code: string,
  text: Record<Text, string>,
  exp: Record<ExportField, string>,
  kept?: Service['ibsCbs'],
): ServiceInput {
  const t = (field: Text) => text[field].trim();
  const exportDone = EXPORT_FIELDS.every((field) => exp[field] !== '');
  const defaults = ibsCbsDefaults(code);
  const ibsCbs =
    t('operationCode') &&
    t('cst') &&
    t('classCode') &&
    (isKept(kept, text) ||
      t('operationCode') !== defaults.operationCode ||
      t('cst') !== defaults.cst ||
      t('classCode') !== defaults.classCode);
  return {
    name: t('name'),
    nationalTaxCode: code,
    ...(t('municipalTaxCode') ? { municipalTaxCode: t('municipalTaxCode') } : {}),
    ...(t('nbsCode') ? { nbsCode: t('nbsCode') } : {}),
    description: t('description'),
    ...(t('pisCofinsCst') ? { pisCofinsCst: t('pisCofinsCst') } : {}),
    ...(ibsCbs
      ? { ibsCbs: { operationCode: t('operationCode'), cst: t('cst'), classCode: t('classCode') } }
      : {}),
    ...(exportDone ? { export: exp as unknown as ServiceExport } : {}),
  };
}

export function ServiceDialog(props: {
  accountId: string;
  emitterId: string;
  service: Service | null; // null for a new service
  initialCode?: ServiceCode; // a new service that starts from a suggested code
  onClose: () => void;
  onSaved: (created?: Service) => void;
}) {
  const { service } = props;
  const base = `/api/accounts/${encodeURIComponent(props.accountId)}`;
  const [code, setCode] = useState<ServiceCode | null>(
    service ? { code: service.nationalTaxCode, description: '' } : (props.initialCode ?? null),
  );
  const [query, setQuery] = useState('');
  const found = useSearch<ServiceCode>(`${base}/service-codes`, query);
  const suggested = useSuggestedCodes(base, props.emitterId);
  const typing = query.trim() !== '';
  const [text, setText] = useState(() => ({
    ...textOf(service, props.initialCode?.code),
    ...(!service && props.initialCode ? { description: props.initialCode.description } : {}),
  }));
  const [exp, setExp] = useState<Record<ExportField, string>>(
    () =>
      Object.fromEntries(EXPORT_FIELDS.map((f) => [f, service?.export?.[f] ?? ''])) as Record<
        ExportField,
        string
      >,
  );
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: Text) => (value: string) => setText((t) => ({ ...t, [field]: value }));
  const input = (field: Text, label: string, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})}>
      <Input value={text[field]} onChange={(e) => set(field)(e.target.value)} />
    </Field>
  );

  function choose(option: ComboboxOption | null) {
    const chosen = option
      ? ([...found, ...suggested.codes].find((c) => c.code === option.value) ?? null)
      : null;
    // The official description fills an empty field or replaces the one the last code filled.
    if (chosen && (text.description.trim() === '' || text.description === code?.description)) {
      set('description')(chosen.description);
    }
    // Codes still equal to the defaults of the last code follow the new one.
    const old = code ? ibsCbsDefaults(code.code) : null;
    const untouched =
      text.operationCode === (old?.operationCode ?? '') &&
      text.cst === (old?.cst ?? '') &&
      text.classCode === (old?.classCode ?? '');
    if (untouched && !EXPORT_FIELDS.every((field) => exp[field] !== '')) {
      const next = chosen ? ibsCbsDefaults(chosen.code) : null;
      setText((t) => ({
        ...t,
        operationCode: next?.operationCode ?? '',
        cst: next?.cst ?? '',
        classCode: next?.classCode ?? '',
      }));
    }
    setCode(chosen);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!code || !text.name.trim() || !text.description.trim()) {
      setError('Informe o código nacional, o nome e a descrição.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = serviceBody(code.code, text, exp, service?.ibsCbs);
      if (service) {
        await api.put(`${base}/services/${encodeURIComponent(service.id)}`, body);
        props.onSaved();
      } else {
        props.onSaved(
          await api.post<Service>(
            `${base}/emitters/${encodeURIComponent(props.emitterId)}/services`,
            body,
          ),
        );
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={service ? 'Editar serviço' : 'Novo serviço'} onClose={props.onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Código nacional">
          <Combobox
            label="Código nacional"
            query={query}
            onQueryChange={setQuery}
            options={(typing ? suggested.rank(found) : suggested.codes).map(codeOption)}
            {...(!typing && suggested.codes.length > 0 ? { heading: SUGGESTED_HEADING } : {})}
            selected={code ? codeOption(code) : null}
            onSelect={choose}
            placeholder="Busque pelo nome ou pelo código"
          />
        </Field>
        {input('name', 'Nome', 'Como o serviço aparece na lista do NotaFlow.')}
        <Field label="Descrição">
          <Textarea
            maxLength={2000}
            value={text.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </Field>
        <div>
          <Button type="button" variant="secondary" onClick={() => setMore((m) => !m)}>
            {more ? 'Menos opções' : 'Mais opções'}
          </Button>
        </div>
        {more && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {input('municipalTaxCode', 'Código municipal')}
              {input('nbsCode', 'NBS')}
              {input('pisCofinsCst', 'CST do PIS/COFINS')}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {input('operationCode', 'Indicador de operação (IBS/CBS)')}
              {input('cst', 'CST do IBS/CBS')}
              {input('classCode', 'Classificação tributária (IBS/CBS)')}
            </div>
            <p className="text-sm text-muted">Exportação (para clientes no exterior)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {EXPORT_FIELDS.map((field) => (
                <Field key={field} label={EXPORT_LABELS[field]}>
                  <Select
                    value={exp[field]}
                    onChange={(e) => setExp((x) => ({ ...x, [field]: e.target.value }))}
                  >
                    <option value="">Padrão do NotaFlow</option>
                    {EXPORT_OPTIONS[field].map(([value, label]) => (
                      <option key={value} value={value}>
                        {value} – {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </div>
        )}
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            Salvar serviço
          </Button>
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
