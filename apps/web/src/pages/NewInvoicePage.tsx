import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  api,
  type Customer,
  type Emitter,
  type ExchangeRate,
  type FiscalConfig,
  type Service,
  type ServiceCode,
} from '../api';
import { AmountInput, currencySymbol } from '../components/AmountInput';
import { DiscardPendingDialog } from '../components/DiscardPendingDialog';
import { CustomerEmailNote } from '../components/CustomerEmailNote';
import { EnvironmentBadge } from '../components/EnvironmentBadge';
import { IssueResultView } from '../components/IssueResultView';
import { Layout, errorText } from '../components/Layout';
import { roleIn, showsEnvironment, useMe } from '../components/MeContext';
import { NewCustomerForm } from '../components/NewCustomerForm';
import { useAsync } from '../components/useAsync';
import { useIssueSend } from '../components/useIssueSend';
import { SUGGESTED_HEADING, useSuggestedCodes } from '../components/suggestedCodes';
import { useSearch } from '../components/useSearch';
import {
  brasiliaToday,
  centsInput,
  formatCents,
  formatCompetence,
  formatDate,
  formatServiceCode,
  issMinimumHint,
  parseCents,
  parsePercent,
  percentInput,
  previousMonthEnd,
} from '../format';
import { routeHref } from '../router';
import { ServiceDialog } from './ServiceDialog';
import {
  Alert,
  Button,
  CARD_CLASSES,
  Card,
  Combobox,
  type ComboboxOption,
  DateInput,
  Field,
  FORM_CLASSES,
  Input,
  Link,
  Modal,
  SECTION_TITLE_CLASSES,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  Textarea,
} from '../ui';
import { EXPORT_LABELS, EXPORT_OPTIONS } from '../exportCodes';
import {
  type Complete,
  completeBody,
  completeFrom,
  EXPORT_FIELDS,
  ibsCbsShown,
  serviceFields,
  withCode,
  isAbroad,
  withCustomerMode,
} from './completeMode';
import { revenueIsStale } from '../components/simplesRates';

const CURRENCIES = { '220': 'USD', '978': 'EUR' } as const;
type CurrencyCode = keyof typeof CURRENCIES;

interface Form {
  emitterId: string;
  customer: Customer | null;
  serviceId: string;
  competence: string;
  description: string;
  brl: string;
  currencyCode: CurrencyCode;
  foreign: string;
  more: Complete | null; // "Mais opções", null while closed
}

const customerOption = (c: Customer): ComboboxOption => ({
  value: c.id,
  label: `${c.name} (${c.document ?? 'sem documento'})`,
});

export function NewInvoicePage(props: { accountId: string; customerId?: string }) {
  const { accountId } = props;
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const emitters = useAsync(() => api.get<Emitter[]>(`${base}/emitters`), [base]);
  return (
    <Layout title="Nova nota" accountId={accountId}>
      {emitters.error && <Alert variant="error">{errorText(emitters.error)}</Alert>}
      {!emitters.data && !emitters.error && <Spinner />}
      {emitters.data && emitters.data.length === 0 && (
        <Alert variant="info">
          Cadastre um emitente antes de emitir.{' '}
          <Link href={routeHref({ name: 'emitters', accountId })}>Ir para os emitentes</Link>
        </Alert>
      )}
      {emitters.data && emitters.data.length > 0 && (
        <NewInvoiceFlow
          accountId={accountId}
          emitters={emitters.data}
          {...(props.customerId ? { customerId: props.customerId } : {})}
        />
      )}
    </Layout>
  );
}

function NewInvoiceFlow(props: { accountId: string; emitters: Emitter[]; customerId?: string }) {
  const { accountId, emitters } = props;
  const base = `/api/accounts/${encodeURIComponent(accountId)}`;
  const me = useMe();
  const send = useIssueSend<Form>({ accountId, storageKey: `notaflow.newInvoice.${accountId}` });
  const fresh = (): Form => ({
    emitterId: emitters[0]?.id ?? '',
    customer: null,
    serviceId: '',
    competence: previousMonthEnd(brasiliaToday()),
    description: '',
    brl: '',
    currencyCode: '220',
    foreign: '',
    more: null,
  });
  const [discarding, setDiscarding] = useState(false);
  const [form, setForm] = useState<Form>(() => send.restored ?? fresh());
  const set = <K extends keyof Form>(field: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [field]: value }));
  const emitter = emitters.find((e) => e.id === form.emitterId) ?? emitters[0];
  const emitterUrl = `${base}/emitters/${encodeURIComponent(form.emitterId)}`;
  const fiscal = useAsync(() => api.get<FiscalConfig>(`${emitterUrl}/fiscal`), [emitterUrl]);
  const services = useAsync(() => api.get<Service[]>(`${emitterUrl}/services`), [emitterUrl]);
  const [customerQuery, setCustomerQuery] = useState('');
  const found = useSearch<Customer>(
    `${base}/customers?emitterId=${encodeURIComponent(form.emitterId)}`,
    customerQuery,
    { listWhenEmpty: true },
  );
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [codeQuery, setCodeQuery] = useState('');
  const foundCodes = useSearch<ServiceCode>(`${base}/service-codes`, codeQuery);
  const suggestedCodes = useSuggestedCodes(base, form.emitterId);
  const typingCode = codeQuery.trim() !== '';
  const [registering, setRegistering] = useState<ServiceCode | null>(null);

  // A customer from the link ("Emitir nota" on the customer page) starts selected.
  const linked = props.customerId;
  useEffect(() => {
    if (!linked || send.restored) return;
    void api.get<Customer>(`${base}/customers/${encodeURIComponent(linked)}`).then(
      (customer) => {
        if (customer.archived) return;
        setForm((f) =>
          f.emitterId === customer.emitterId
            ? { ...f, customer }
            : {
                ...f,
                emitterId: customer.emitterId,
                customer,
                serviceId: '',
                more: null,
              },
        );
      },
      () => {},
    );
  }, [base, linked, send.restored]);

  const customer = form.customer;
  const abroad = isAbroad(customer);
  const service = services.data?.find((s) => s.id === form.serviceId) ?? null;
  const brlCents = parseCents(form.brl);
  const foreignCents = abroad ? parseCents(form.foreign) : null;

  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const reviewing = useRef(send.key !== null);
  reviewing.current = send.key !== null;
  useEffect(() => {
    if (!abroad || foreignCents === null || foreignCents <= 0 || !form.competence) return;
    if (reviewing.current) return;
    let live = true;
    setRateLoading(true);
    // Waits for the user to stop typing before asking the Banco Central.
    const timer = setTimeout(() => {
      api
        .get<ExchangeRate>(
          `${base}/exchange-rate?currency=${form.currencyCode}&date=${form.competence}`,
        )
        .then(
          (answer) => {
            if (!live || reviewing.current) return;
            setRate(answer);
            setRateError(null);
            setForm((f) => ({
              ...f,
              brl: centsInput(Math.round((foreignCents * answer.rateE4) / 10_000)),
            }));
          },
          (error: unknown) => {
            if (!live) return;
            setRate(null);
            setRateError(errorText(error));
          },
        )
        .finally(() => {
          if (live) setRateLoading(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [abroad, base, foreignCents, form.competence, form.currencyCode]);

  if (send.result) {
    return (
      <IssueResultView
        accountId={accountId}
        environment={emitter?.environment ?? 'producao'}
        send={send}
      />
    );
  }
  if (!emitter) return null;
  if (fiscal.error) return <Alert variant="error">{errorText(fiscal.error)}</Alert>;
  if (services.error) return <Alert variant="error">{errorText(services.error)}</Alert>;
  if (!fiscal.data || !services.data) return <Spinner />;
  const config = fiscal.data;
  if (!config.rates || !config.simplesAnnex) {
    return roleIn(me, accountId) === 'owner' ? (
      <Alert variant="warning">
        Informe a receita dos últimos 12 meses e o ISS do emitente antes de emitir.{' '}
        <Link href={routeHref({ name: 'emitter', accountId, emitterId: emitter.id })}>
          Configurar o emitente
        </Link>
      </Alert>
    ) : (
      <Alert variant="warning">
        Peça ao dono da conta para informar a receita dos últimos 12 meses e o ISS do emitente antes
        de emitir.
      </Alert>
    );
  }
  // The rate of this invoice: the effective one, or the export one without ISS, PIS, and COFINS.
  const ratePercent = abroad ? config.rates.export : config.rates.domestic;
  const rateText = `${percentInput(ratePercent)}% (faixa ${config.simplesBand ?? ''}${
    abroad ? ', exportação sem ISS, PIS e COFINS' : ''
  })`;
  const activeServices = services.data.filter((s) => !s.archived);
  // Only the owner registers services; a code already registered is not suggested again.
  const registered = new Set(activeServices.map((s) => s.nationalTaxCode));
  const suggestions =
    roleIn(me, accountId) === 'owner'
      ? suggestedCodes.codes.filter((c) => !registered.has(c.code))
      : [];
  const currency = CURRENCIES[form.currencyCode];

  const canRetain = customer?.documentType === 'CNPJ';
  const more = form.more;
  const complete =
    more && service
      ? completeBody(more, service, {
          canRetain,
          abroad,
          bandIss: config.rates.iss,
          serviceCents: brlCents,
        })
      : { body: {}, changes: [] as string[] };
  const setMore = (patch: Partial<Complete>) =>
    setForm((f) => (f.more ? { ...f, more: { ...f.more, ...patch } } : f));
  const effectiveCode = more?.code?.code ?? service?.nationalTaxCode ?? '';

  const valid =
    complete !== null &&
    customer !== null &&
    customer.documentType !== 'NONE' &&
    service !== null &&
    form.competence !== '' &&
    form.description.trim() !== '' &&
    brlCents !== null &&
    brlCents > 0 &&
    (!abroad || (foreignCents !== null && foreignCents > 0 && rate !== null && !rateLoading));

  function chooseService(serviceId: string) {
    const suggestion = suggestions.find((c) => `suggested:${c.code}` === serviceId);
    if (suggestion) {
      setRegistering(suggestion);
      return;
    }
    const next = activeServices.find((s) => s.id === serviceId);
    applyService(serviceId, next ?? null);
  }

  function applyService(serviceId: string, next: Service | null) {
    setForm((f) => ({
      ...f,
      serviceId,
      // A new service brings its own codes into "Mais opções".
      more: f.more ? { ...f.more, ...serviceFields(next) } : null,
      // The service text fills an empty description or replaces the one the last service filled.
      description:
        next && (f.description.trim() === '' || f.description === service?.description)
          ? next.description
          : f.description,
    }));
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (valid) send.startReview();
  }

  function confirm() {
    if (!customer || !service || brlCents === null) return;
    void send.send(form, `${base}/invoices/new`, {
      emitterId: form.emitterId,
      customerId: customer.id,
      serviceId: service.id,
      competence: form.competence,
      serviceCents: brlCents,
      ...(abroad && foreignCents
        ? { foreignCurrency: form.currencyCode, foreignAmountCents: foreignCents }
        : {}),
      description: form.description.trim(),
      // A typed Simples percent replaces the computed one.
      ...complete?.body,
    });
  }

  const issLine = abroad
    ? 'Exportação: sem ISS'
    : canRetain && more?.issRetained
      ? 'Retido pelo cliente'
      : 'ISS no DAS (não retido)';

  if (send.key) {
    const production = emitter.environment === 'producao';
    const namesEnvironment = showsEnvironment(me, emitter.environment);
    const rows: [string, string][] = [
      ['Emitente', emitter.companyName],
      ['Cliente', customer?.name ?? ''],
      ['Serviço', service ? `${formatServiceCode(service.nationalTaxCode)} – ${service.name}` : ''],
      ['Competência', formatCompetence(form.competence)],
      ['Descrição', form.description.trim()],
      [
        'Valor',
        abroad && foreignCents !== null
          ? `${formatCents(brlCents ?? 0)} (${currency} ${centsInput(foreignCents)})`
          : formatCents(brlCents ?? 0),
      ],
      [
        'Alíquota do Simples',
        complete?.body.simplesPercent !== undefined
          ? `Percentual informado: ${percentInput(complete.body.simplesPercent)}%`
          : rateText,
      ],
      ['ISS', issLine],
    ];
    return (
      <>
        <EnvironmentBadge environment={emitter.environment} />
        <Card>
          <Table>
            <TBody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <TH scope="row">{label}</TH>
                  <TD>{value}</TD>
                </tr>
              ))}
              {complete && complete.changes.length > 0 && (
                <tr className="bg-warning/10">
                  <TH scope="row">Alterado nesta nota</TH>
                  <TD>
                    {complete.changes.map((change) => (
                      <div key={change}>{change}</div>
                    ))}
                  </TD>
                </tr>
              )}
            </TBody>
          </Table>
        </Card>
        {send.error && <Alert variant="error">{send.error}</Alert>}
        {send.locked && props.customerId && send.restored && (
          <Alert variant="info">
            Há um envio pendente nesta conta. O cliente do link foi ignorado até você concluir ou
            descartar este envio.
          </Alert>
        )}
        <DiscardPendingDialog
          accountId={accountId}
          open={discarding}
          onCancel={() => setDiscarding(false)}
          onDiscard={() => {
            setDiscarding(false);
            send.discard();
            setForm(fresh());
          }}
        />
        <div className="flex flex-wrap gap-3">
          <Button
            variant={production && namesEnvironment ? 'danger' : 'primary'}
            disabled={send.busy}
            onClick={confirm}
          >
            {send.locked
              ? 'Tentar de novo'
              : !namesEnvironment
                ? 'Emitir nota'
                : production
                  ? 'Emitir em PRODUÇÃO'
                  : 'Emitir em produção restrita'}
          </Button>
          {!send.locked && (
            <Button variant="secondary" disabled={send.busy} onClick={() => send.backToEdit()}>
              Voltar e editar
            </Button>
          )}
          {send.locked && (
            <Button variant="secondary" disabled={send.busy} onClick={() => setDiscarding(true)}>
              Descartar envio pendente
            </Button>
          )}
          {send.busy && <Spinner label="Emitindo" />}
          <CustomerEmailNote accountId={accountId} emitter={emitter} />
        </div>
      </>
    );
  }

  return (
    <>
      <EnvironmentBadge environment={emitter.environment} />
      <form onSubmit={review} className={`${CARD_CLASSES} ${FORM_CLASSES}`}>
        <h2 className={SECTION_TITLE_CLASSES}>Nova nota sem modelo</h2>
        {emitters.length > 1 && (
          <Field label="Emitente">
            <Select
              value={form.emitterId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  emitterId: e.target.value,
                  customer: null,
                  serviceId: '',
                  more: null,
                }))
              }
            >
              {emitters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.companyName}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field label="Cliente">
              <Combobox
                label="Cliente"
                query={customerQuery}
                onQueryChange={setCustomerQuery}
                options={found.filter((c) => !c.archived).map(customerOption)}
                selected={customer ? customerOption(customer) : null}
                onSelect={(option) => {
                  const next = option ? (found.find((c) => c.id === option.value) ?? null) : null;
                  setForm((f) => ({
                    ...f,
                    customer: next,
                    more:
                      f.more && isAbroad(next) !== isAbroad(f.customer)
                        ? withCustomerMode(
                            f.more,
                            services.data?.find((s) => s.id === f.serviceId) ?? null,
                          )
                        : f.more,
                  }));
                }}
                placeholder="Nome ou documento"
              />
            </Field>
          </div>
          <Button type="button" variant="secondary" onClick={() => setCreatingCustomer(true)}>
            + Novo cliente
          </Button>
        </div>
        {customer?.documentType === 'NONE' && (
          <Alert variant="warning">
            Um cliente sem documento ainda não pode receber nota. Cadastre o NIF do cliente.
          </Alert>
        )}
        <Field label="Serviço">
          <Select value={form.serviceId} onChange={(e) => chooseService(e.target.value)}>
            <option value="">Escolha um serviço</option>
            {activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({formatServiceCode(s.nationalTaxCode)})
              </option>
            ))}
            {suggestions.length > 0 && (
              <optgroup label={SUGGESTED_HEADING}>
                {suggestions.map((c) => (
                  <option key={c.code} value={`suggested:${c.code}`}>
                    Cadastrar: {formatServiceCode(c.code)} – {c.description}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {activeServices.length === 0 && (
          <p className="text-sm text-muted">
            Nenhum serviço ainda. O dono da conta cadastra os serviços na página do emitente.
          </p>
        )}
        <Field label="Competência">
          <DateInput
            required
            max={brasiliaToday()}
            value={form.competence}
            onChange={(e) => set('competence', e.target.value)}
          />
        </Field>
        <Field label="Descrição">
          <Textarea
            maxLength={2000}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        {abroad && (
          <div className="flex flex-col gap-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Moeda">
                <Select
                  value={form.currencyCode}
                  onChange={(e) => set('currencyCode', e.target.value as CurrencyCode)}
                >
                  <option value="220">Dólar (USD)</option>
                  <option value="978">Euro (EUR)</option>
                </Select>
              </Field>
              <Field label={`Valor em ${currency}`}>
                <AmountInput
                  unit={currencySymbol(currency)}
                  value={form.foreign}
                  onValueChange={(text) => set('foreign', text)}
                />
              </Field>
            </div>
            {rateLoading && <p className="text-sm text-muted">Buscando a cotação PTAX…</p>}
            {!rateLoading && rate && (
              <p className="text-sm text-muted">
                PTAX venda de {formatDate(`${rate.date}T12:00:00Z`)}: {rate.rate.replace('.', ',')}
              </p>
            )}
            {rateError && <Alert variant="warning">{rateError}</Alert>}
          </div>
        )}
        <Field label="Valor em reais">
          <AmountInput
            unit="R$"
            readOnly={abroad}
            value={form.brl}
            onValueChange={(text) => set('brl', text)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-fg">Alíquota do Simples</span>
            <p className="text-sm text-muted">{rateText}</p>
            {revenueIsStale(config.simplesRbt12At) && (
              <Alert variant="warning">
                Atualize a receita dos últimos 12 meses na configuração fiscal: a alíquota deste mês
                depende dela.
              </Alert>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-fg">ISS</span>
            <p className="text-sm text-muted">{issLine}</p>
          </div>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setForm((f) => ({ ...f, more: f.more ? null : completeFrom(service, config) }))
            }
          >
            {more ? 'Menos opções' : 'Mais opções'}
          </Button>
        </div>
        {more && (
          <div className="flex flex-col gap-4">
            {canRetain && (
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={more.issRetained}
                  onChange={(e) => setMore({ issRetained: e.target.checked })}
                />
                ISS retido pelo cliente
              </label>
            )}
            {canRetain && (
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={more.inssRetained}
                  onChange={(e) =>
                    setMore({
                      inssRetained: e.target.checked,
                      // Lei 8.212, art. 31: 11% of the service, less what the contract allows.
                      inssAmount:
                        e.target.checked && brlCents !== null
                          ? centsInput(Math.round(brlCents * 0.11))
                          : '',
                    })
                  }
                />
                INSS retido pelo cliente
              </label>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {canRetain && more.issRetained && (
                <Field
                  label="Alíquota de ISS (%)"
                  hint={
                    config.rates.iss !== null && parsePercent(more.issRate) === config.rates.iss
                      ? `Parcela do ISS na faixa ${config.simplesBand ?? ''} do Simples Nacional.`
                      : issMinimumHint(effectiveCode)
                  }
                >
                  <AmountInput
                    unit="%"
                    value={more.issRate}
                    onValueChange={(text) => setMore({ issRate: text })}
                  />
                </Field>
              )}
              {canRetain && more.inssRetained && (
                <Field
                  label="INSS retido (R$)"
                  hint="11% do valor do serviço. Ajuste se o contrato desconta materiais ou equipamentos."
                >
                  <AmountInput
                    unit="R$"
                    value={more.inssAmount}
                    onValueChange={(text) => setMore({ inssAmount: text })}
                  />
                </Field>
              )}
              <Field label="Outro percentual do Simples (%)" hint="Em branco: a faixa escolhida.">
                <AmountInput
                  unit="%"
                  value={more.simplesOther}
                  onValueChange={(text) => setMore({ simplesOther: text })}
                />
              </Field>
            </div>
            <Field label="Código nacional">
              <Combobox
                label="Código nacional"
                query={codeQuery}
                onQueryChange={setCodeQuery}
                {...(!typingCode && suggestedCodes.codes.length > 0
                  ? { heading: SUGGESTED_HEADING }
                  : {})}
                options={(typingCode ? suggestedCodes.rank(foundCodes) : suggestedCodes.codes).map(
                  (c) => ({
                    value: c.code,
                    label: `${formatServiceCode(c.code)} – ${c.description}`,
                  }),
                )}
                selected={
                  more.code
                    ? {
                        value: more.code.code,
                        label: more.code.description
                          ? `${formatServiceCode(more.code.code)} – ${more.code.description}`
                          : formatServiceCode(more.code.code),
                      }
                    : null
                }
                onSelect={(option) =>
                  setMore(
                    withCode(
                      more,
                      service,
                      abroad,
                      option
                        ? ([...foundCodes, ...suggestedCodes.codes].find(
                            (c) => c.code === option.value,
                          ) ?? null)
                        : null,
                    ),
                  )
                }
                placeholder="Busque pelo nome ou pelo código"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['municipalTaxCode', 'Código municipal'],
                  ['nbsCode', 'NBS'],
                  ['pisCofinsCst', 'CST do PIS/COFINS'],
                ] as const
              ).map(([field, label]) => (
                <Field key={field} label={label}>
                  <Input
                    value={more[field]}
                    onChange={(e) => setMore({ [field]: e.target.value })}
                  />
                </Field>
              ))}
              {(
                [
                  ['operationCode', 'Indicador de operação (IBS/CBS)'],
                  ['cst', 'CST do IBS/CBS'],
                  ['classCode', 'Classificação tributária (IBS/CBS)'],
                ] as const
              ).map(([field, label]) => (
                <Field key={field} label={label}>
                  <Input
                    value={ibsCbsShown(more, service, abroad)[field]}
                    onChange={(e) =>
                      // The first edit freezes the shown codes, so the other two stay as they were.
                      setMore({
                        ...ibsCbsShown(more, service, abroad),
                        ibsCbsEdited: true,
                        [field]: e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            {abroad && (
              <div className="grid gap-4 sm:grid-cols-2">
                {EXPORT_FIELDS.map((field) => (
                  <Field key={field} label={EXPORT_LABELS[field]}>
                    <Select
                      value={more.export[field]}
                      onChange={(e) =>
                        setMore({ export: { ...more.export, [field]: e.target.value } })
                      }
                    >
                      <option value="">Padrão do serviço</option>
                      {EXPORT_OPTIONS[field].map(([value, label]) => (
                        <option key={value} value={value}>
                          {value} – {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            )}
          </div>
        )}
        {more && service && complete === null && (
          <Alert variant="warning">
            Revise Mais opções: um percentual inválido (ISS até 5,00%, Simples até 99,99%) ou um
            grupo incompleto (preencha todos os campos do IBS/CBS ou da exportação, ou nenhum).
          </Alert>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={!valid}>
            Revisar
          </Button>
        </div>
      </form>
      <Modal
        open={creatingCustomer}
        title="Novo cliente"
        onClose={() => setCreatingCustomer(false)}
      >
        {creatingCustomer && (
          <NewCustomerForm
            accountId={accountId}
            emitters={emitters}
            emitterId={form.emitterId}
            onCreated={(created) => {
              set('customer', created);
              setCreatingCustomer(false);
            }}
            onCancel={() => setCreatingCustomer(false)}
          />
        )}
      </Modal>
      {registering && (
        <ServiceDialog
          accountId={accountId}
          emitterId={form.emitterId}
          service={null}
          initialCode={registering}
          onClose={() => setRegistering(null)}
          onSaved={(created) => {
            setRegistering(null);
            services.reload();
            if (created) applyService(created.id, created);
          }}
        />
      )}
    </>
  );
}
