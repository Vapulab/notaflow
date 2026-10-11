import type {
  AccountContext,
  InvoiceIssuer,
  InvoiceParty,
  IssueOutcome,
  IssueSource,
  NewInvoiceInput,
  PartyAddress,
} from '@notaflow/core';
import {
  type DpsTemplate,
  formatBrasiliaDate,
  minimumIssRate,
  parseNfseXml,
  readTemplate,
  simplesIssRate,
  simplesRate,
  TemplateUnsupportedError,
} from '@notaflow/provider-nacional';
import { country, municipality } from '../data/places';
import { serviceCode } from '../data/serviceCodes';
import type { Database } from '../db/openDatabase';
import { isCalendarDate, xsdDescription } from '../domain/xmlText';
import { BACEN_CURRENCY, convertToCents, type ExchangeRateSource } from '../exchange/ptax';
import { HttpError } from '../httpError';
import type { IssuerFactory } from '../providers/providerFactory';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository, type CustomerRow } from '../repos/CustomerRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { DPS_NUMBER_TAKEN, InvoiceRepository, isOwnInvoice } from '../repos/InvoiceRepository';
import { ServiceRepository } from '../repos/ServiceRepository';
import type { VaultCertificateStore } from '../vault/VaultCertificateStore';

export interface IssueInput {
  templateInvoiceId: string;
  competence: string;
  serviceCents: number;
  foreignAmountCents?: number;
  description?: string;
  customerId?: string;
}

export interface NewInvoiceRequest {
  emitterId: string;
  customerId: string;
  serviceId: string;
  competence: string;
  serviceCents: number;
  foreignCurrency?: string; // BACEN code
  foreignAmountCents?: number;
  simplesPercent?: number; // hundredths; the emitter's band when absent
  issRate?: number; // hundredths; the emitter's rate when absent
  issRetained?: boolean;
  description?: string;
  // Complete mode: replaces these fields of the saved service for this invoice only.
  overrides?: Partial<
    Pick<
      NewInvoiceInput['service'],
      'nationalTaxCode' | 'municipalTaxCode' | 'nbsCode' | 'pisCofinsCst' | 'ibsCbs' | 'export'
    >
  >;
}

// Sefin refusals that mean the invoice is already cancelled (E0840, confirmed in the Stage 1b acceptance).
export const ALREADY_CANCELLED_CODES = ['E0840'];

export interface IssueResultView {
  id: string;
  status: 'pending' | 'issued' | 'rejected' | 'unknown' | 'cancelled';
  number?: string;
  accessKey?: string;
  errors?: { code: string; message: string }[];
}

export class IssueService {
  private readonly invoices: InvoiceRepository;
  private readonly emitters: EmitterRepository;
  private readonly customers: CustomerRepository;
  private readonly services: ServiceRepository;
  private readonly audit: AuditLog;

  constructor(
    private readonly deps: {
      db: Database;
      certificates: VaultCertificateStore;
      issuerFactory: IssuerFactory;
      exchangeRate: ExchangeRateSource;
      now?: () => Date;
    },
  ) {
    this.invoices = new InvoiceRepository(deps.db);
    this.emitters = new EmitterRepository(deps.db);
    this.customers = new CustomerRepository(deps.db);
    this.services = new ServiceRepository(deps.db);
    this.audit = new AuditLog(deps.db);
  }

  draft(ctx: AccountContext, invoiceId: string) {
    const { state, xml, template } = this.loadTemplate(ctx, invoiceId);
    const foreignTrade = template.service.foreignTrade;
    return {
      templateInvoiceId: invoiceId,
      emitterId: state.emitterId,
      competence: state.competence,
      serviceCents: template.serviceCents,
      description: template.service.description,
      customer: parseNfseXml(xml).customer,
      foreign: foreignTrade
        ? {
            currency: BACEN_CURRENCY[foreignTrade.currency] ?? foreignTrade.currency,
            currencyCode: foreignTrade.currency,
            amountCents: foreignTrade.amountInCurrencyCents,
          }
        : null,
    };
  }

  async issue(
    ctx: AccountContext,
    actor: string,
    input: IssueInput,
    idempotencyKey?: string,
  ): Promise<{ view: IssueResultView; repeat: boolean }> {
    const { state, xml, template } = this.loadTemplate(ctx, input.templateInvoiceId);
    const repeated = () =>
      idempotencyKey
        ? this.invoices.findByIdempotencyKey(ctx, state.emitterId, idempotencyKey)
        : null;
    const earlier = repeated();
    if (earlier) return { view: this.view(ctx, earlier), repeat: true };
    if (input.serviceCents <= 0) throw new HttpError(400, 'invalid_amount');
    if (
      template.service.foreignTrade &&
      !(input.foreignAmountCents && input.foreignAmountCents > 0)
    ) {
      throw new HttpError(400, 'invalid_amount');
    }
    const now = this.now();
    checkCompetence(input.competence, now);
    const ptax =
      template.service.foreignTrade && input.foreignAmountCents
        ? await this.checkPtax(
            template.service.foreignTrade.currency,
            input.competence,
            input.foreignAmountCents,
            input.serviceCents,
          )
        : null;
    const customer = input.customerId ? this.customerParty(ctx, input.customerId) : undefined;
    if (customer && !customer.document) throw new HttpError(400, 'customer_without_document');
    const emitter = this.emitters.get(ctx, state.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    const certificate = await this.deps.certificates.loadActive(ctx, emitter.id);
    if (!certificate) throw new HttpError(409, 'no_active_certificate');
    const issuer = this.deps.issuerFactory({ environment: emitter.environment, certificate });

    const templateCustomer = template.customer;
    const description = checkDescription(input.description) ?? template.service.description;
    // With a revenue set, a copy takes this month's rate; without it, the rate of the original stays.
    const fiscal = this.emitters.fiscalConfig(ctx, emitter.id);
    const simplesPercent =
      fiscal?.simplesAnnex && fiscal.simplesRbt12Cents !== null
        ? simplesRate(fiscal.simplesAnnex, fiscal.simplesRbt12Cents, {
            export: template.service.foreignTrade !== undefined,
          })
        : undefined;
    const pending = this.deps.db.transaction(() => {
      // A second request with the same key may have passed the first check while this one awaited.
      const raced = repeated();
      if (raced) return { id: raced, number: null };
      const number = this.emitters.reserveDpsNumber(ctx, emitter.id);
      const id = this.invoices.createPending(ctx, {
        emitterId: emitter.id,
        dpsId: issuer.dpsId(emitter.dpsSeries, number, { kind: 'stored', xml }),
        dpsSeries: emitter.dpsSeries,
        dpsNumber: number,
        competence: input.competence,
        serviceCents: input.serviceCents,
        ...(input.foreignAmountCents ? { foreignAmountCents: input.foreignAmountCents } : {}),
        description,
        customerId: input.customerId ?? state.customerId,
        customerDocument: customer?.document?.value ?? templateCustomer?.document.value ?? null,
        customerName: customer?.name ?? templateCustomer?.name ?? null,
        serviceCode: template.service.nationalTaxCode,
        environment: emitter.environment,
        templateOf: input.templateInvoiceId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      this.audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action: 'invoice.issue',
        entity: id,
        result: 'ok',
        detail: ptax ? `pending, ${ptax}` : 'pending',
      });
      return { id, number };
    });
    if (pending.number === null) return { view: this.view(ctx, pending.id), repeat: true };

    const outcome = await this.send(issuer, {
      source: { kind: 'stored', xml },
      series: emitter.dpsSeries,
      number: pending.number,
      // The Sefin refuses a future dhEmi, and clocks drift.
      issuedAt: new Date(now.getTime() - 60_000),
      competence: input.competence,
      serviceCents: input.serviceCents,
      ...(input.foreignAmountCents ? { foreignAmountCents: input.foreignAmountCents } : {}),
      description,
      ...(customer ? { customer } : {}),
      ...(simplesPercent !== undefined ? { simplesPercent } : {}),
    });
    return {
      view: this.record(ctx, actor, 'invoice.issue', pending.id, emitter.id, outcome),
      repeat: false,
    };
  }

  async issueNew(
    ctx: AccountContext,
    actor: string,
    input: NewInvoiceRequest,
    idempotencyKey?: string,
  ): Promise<{ view: IssueResultView; repeat: boolean }> {
    const emitter = this.emitters.get(ctx, input.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    const repeated = () =>
      idempotencyKey ? this.invoices.findByIdempotencyKey(ctx, emitter.id, idempotencyKey) : null;
    const earlier = repeated();
    if (earlier) return { view: this.view(ctx, earlier), repeat: true };
    // The builder writes the Simples total percent, which only an ME/EPP optant has.
    if (emitter.simplesNacional !== '3') throw new HttpError(409, 'emitter_not_simples');

    const fiscal = this.emitters.fiscalConfig(ctx, emitter.id);
    if (!fiscal || fiscal.simplesPercent === null) {
      throw new HttpError(409, 'fiscal_config_missing');
    }
    const saved = this.services.get(ctx, input.serviceId);
    if (!saved || saved.emitterId !== emitter.id || saved.archived) {
      throw new HttpError(404, 'service_not_found');
    }
    const service = { ...saved, ...input.overrides };
    if (!serviceCode(service.nationalTaxCode)) throw new HttpError(400, 'unknown_service_code');
    const customerRow = this.customers.get(ctx, input.customerId);
    if (!customerRow || customerRow.emitterId !== emitter.id) {
      throw new HttpError(404, 'customer_not_found');
    }
    const customer = partyOf(customerRow);
    if (!customer.document) throw new HttpError(400, 'customer_without_document');
    const abroad = customer.document.type === 'NIF';
    if (abroad && (customer.address?.kind !== 'foreign' || customer.address.country === 'BR')) {
      throw new HttpError(400, 'customer_country_missing');
    }
    if (!abroad && customer.address?.kind !== 'domestic') {
      throw new HttpError(400, 'customer_address_incomplete');
    }
    const address = customer.address;
    if (address?.kind === 'domestic' && !municipality(address.municipality)) {
      throw new HttpError(400, 'unknown_municipality');
    }
    if (address?.kind === 'foreign' && !country(address.country)) {
      throw new HttpError(400, 'unknown_country');
    }
    if (input.serviceCents <= 0) throw new HttpError(400, 'invalid_amount');
    const foreign =
      abroad && input.foreignCurrency && input.foreignAmountCents && input.foreignAmountCents > 0
        ? { currencyCode: input.foreignCurrency, amountCents: input.foreignAmountCents }
        : null;
    if (abroad && !foreign) throw new HttpError(400, 'invalid_amount');
    if (!abroad && (input.foreignCurrency || input.foreignAmountCents)) {
      throw new HttpError(400, 'foreign_amount_not_allowed');
    }
    // The effective rate of this month's revenue (an export leaves out ISS, Cofins, and PIS), or a typed one.
    const simplesPercent =
      input.simplesPercent ??
      (fiscal.simplesAnnex && fiscal.simplesRbt12Cents !== null
        ? simplesRate(fiscal.simplesAnnex, fiscal.simplesRbt12Cents, { export: abroad })
        : null);
    if (simplesPercent === null) throw new HttpError(409, 'simples_revenue_missing');
    if (foreign && !BACEN_CURRENCY[foreign.currencyCode]) {
      throw new HttpError(400, 'unsupported_currency');
    }
    const now = this.now();
    checkCompetence(input.competence, now);
    // The ISS share of the band is the law (CGSN 140, art. 27), even below 2%; a typed rate is not.
    const bandIss =
      fiscal.simplesAnnex && fiscal.simplesRbt12Cents !== null
        ? simplesIssRate(fiscal.simplesAnnex, fiscal.simplesRbt12Cents)
        : null;
    const fromBand = input.issRate === undefined && bandIss !== null;
    const issRate = input.issRate ?? bandIss ?? fiscal.issRate ?? undefined;
    if (input.issRetained) {
      // Only a Brazilian legal entity withholds the ISS; an export has no ISS to withhold.
      if (abroad || customer.document.type === 'CPF') {
        throw new HttpError(400, 'retention_not_allowed');
      }
      if (issRate === undefined) throw new HttpError(409, 'fiscal_config_missing');
      const minimum = minimumIssRate(service.nationalTaxCode);
      if (!fromBand && issRate < minimum) {
        throw new HttpError(400, 'invalid_iss_rate', undefined, {
          minimum: (minimum / 100).toFixed(2),
        });
      }
    }
    // Last of the checks: it is a network call.
    const ptax = foreign
      ? await this.checkPtax(
          foreign.currencyCode,
          input.competence,
          foreign.amountCents,
          input.serviceCents,
        )
      : null;
    const certificate = await this.deps.certificates.loadActive(ctx, emitter.id);
    if (!certificate) throw new HttpError(409, 'no_active_certificate');
    const issuer = this.deps.issuerFactory({ environment: emitter.environment, certificate });

    const description = checkDescription(input.description) ?? service.description;
    const newInvoice: NewInvoiceInput = {
      competence: input.competence,
      emitter: {
        cnpj: emitter.cnpj,
        municipality: emitter.municipality,
        ...(emitter.municipalRegistration
          ? { municipalRegistration: emitter.municipalRegistration }
          : {}),
        simplesNacional: emitter.simplesNacional,
        ...(emitter.simplesRegime ? { simplesRegime: emitter.simplesRegime } : {}),
        specialRegime: emitter.specialRegime as NewInvoiceInput['emitter']['specialRegime'],
      },
      service: {
        nationalTaxCode: service.nationalTaxCode,
        ...(service.municipalTaxCode ? { municipalTaxCode: service.municipalTaxCode } : {}),
        ...(service.nbsCode ? { nbsCode: service.nbsCode } : {}),
        description,
        ...(service.pisCofinsCst ? { pisCofinsCst: service.pisCofinsCst } : {}),
        ...(service.ibsCbs ? { ibsCbs: service.ibsCbs } : {}),
        ...(service.export ? { export: service.export } : {}),
      },
      customer,
      serviceCents: input.serviceCents,
      ...(foreign ? { foreign } : {}),
      simplesPercent,
      ...(issRate !== undefined ? { issRate } : {}),
      ...(input.issRetained ? { issRetained: true } : {}),
    };
    let template: string;
    try {
      template = issuer.buildTemplate(newInvoice);
    } catch (error) {
      if (error instanceof RangeError) throw new HttpError(400, 'invalid_invoice', error.message);
      throw error;
    }
    const source: IssueSource = { kind: 'built', template };

    const pending = this.deps.db.transaction(() => {
      const raced = repeated();
      if (raced) return { id: raced, number: null };
      const number = this.emitters.reserveDpsNumber(ctx, emitter.id);
      const id = this.invoices.createPending(ctx, {
        emitterId: emitter.id,
        dpsId: issuer.dpsId(emitter.dpsSeries, number, source),
        dpsSeries: emitter.dpsSeries,
        dpsNumber: number,
        competence: input.competence,
        serviceCents: input.serviceCents,
        ...(foreign ? { foreignAmountCents: foreign.amountCents } : {}),
        description,
        customerId: customerRow.id,
        customerDocument: customer.document?.value ?? null,
        customerName: customer.name,
        serviceCode: service.nationalTaxCode,
        environment: emitter.environment,
        templateOf: null,
        issueTemplate: template,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      this.audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action: 'invoice.issue',
        entity: id,
        result: 'ok',
        detail: ptax
          ? `pending, built without a template, ${ptax}`
          : 'pending, built without a template',
      });
      return { id, number };
    });
    if (pending.number === null) return { view: this.view(ctx, pending.id), repeat: true };

    const outcome = await this.send(issuer, {
      source,
      series: emitter.dpsSeries,
      number: pending.number,
      issuedAt: new Date(now.getTime() - 60_000),
      competence: input.competence,
      serviceCents: input.serviceCents,
      ...(foreign ? { foreignAmountCents: foreign.amountCents } : {}),
    });
    return {
      view: this.record(ctx, actor, 'invoice.issue', pending.id, emitter.id, outcome),
      repeat: false,
    };
  }

  private view(ctx: AccountContext, invoiceId: string): IssueResultView {
    const row = this.invoices.issueView(ctx, invoiceId);
    if (!row) throw new HttpError(404, 'not_found');
    const errors =
      row.status === 'rejected' ? (row.sefinMessages as IssueResultView['errors']) : undefined;
    return {
      id: invoiceId,
      status: row.status,
      ...(row.number ? { number: row.number } : {}),
      ...(row.accessKey ? { accessKey: row.accessKey } : {}),
      ...(errors ? { errors } : {}),
    };
  }

  async reconcile(ctx: AccountContext, actor: string, invoiceId: string): Promise<IssueResultView> {
    const state = this.invoices.issueState(ctx, invoiceId);
    if (!state) throw new HttpError(404, 'not_found');
    if (
      (state.status !== 'unknown' && state.status !== 'pending') ||
      !state.dpsId ||
      (!state.templateOf && !state.issueTemplate)
    ) {
      throw new HttpError(409, 'not_unknown');
    }
    const emitter = this.emitters.get(ctx, state.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    const certificate = await this.deps.certificates.loadActive(ctx, emitter.id);
    if (!certificate) throw new HttpError(409, 'no_active_certificate');
    // The invoice's own environment: the emitter may have switched since the first send.
    const issuer = this.deps.issuerFactory({ environment: state.environment, certificate });

    let found: Awaited<ReturnType<InvoiceIssuer['findIssued']>>;
    try {
      found = await issuer.findIssued(state.dpsId);
    } catch (error) {
      throw new HttpError(
        502,
        'sefin_unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (found) {
      return this.record(ctx, actor, 'invoice.reconcile', invoiceId, emitter.id, {
        kind: 'issued',
        invoice: found,
        recovered: true,
      });
    }
    const { source, customer } = this.resendSource(ctx, state);
    // The stored source must still rebuild the same DPS id, or the resend would not be this invoice.
    let sameDps = false;
    try {
      sameDps = issuer.dpsId(state.dpsSeries, state.dpsNumber, source) === state.dpsId;
    } catch {
      sameDps = false;
    }
    if (!sameDps) throw new HttpError(422, 'template_unreadable');
    // Only now is a resend safe, and it reuses the same DPS number.
    this.audit.record({
      userEmail: actor,
      accountId: ctx.accountId,
      action: 'invoice.reconcile',
      entity: invoiceId,
      result: 'ok',
      detail: `resent DPS ${state.dpsNumber}`,
    });
    const outcome = await this.send(issuer, {
      source,
      series: state.dpsSeries,
      number: state.dpsNumber,
      issuedAt: new Date(this.now().getTime() - 60_000),
      competence: state.competence,
      serviceCents: state.serviceCents,
      ...(state.foreignAmountCents ? { foreignAmountCents: state.foreignAmountCents } : {}),
      description: state.description,
      ...(customer ? { customer } : {}),
    });
    return this.record(ctx, actor, 'invoice.reconcile', invoiceId, emitter.id, outcome);
  }

  async cancel(
    ctx: AccountContext,
    actor: string,
    invoiceId: string,
    reason: '1' | '2' | '9',
    justification: string,
  ): Promise<{ id: string; status: 'cancelled'; alreadyCancelled?: true }> {
    const invoice = this.invoices.get(ctx, invoiceId);
    if (!invoice) throw new HttpError(404, 'not_found');
    if (invoice.status !== 'issued' || !invoice.accessKey) throw new HttpError(409, 'not_issued');
    const text = justification.trim();
    if (text.length < 15 || text.length > 255) throw new HttpError(400, 'invalid_justification');
    const certificate = await this.deps.certificates.loadActive(ctx, invoice.emitterId);
    if (!certificate) throw new HttpError(409, 'no_active_certificate');
    // The invoice's own environment, even when the emitter has switched since.
    const issuer = this.deps.issuerFactory({ environment: invoice.environment, certificate });
    const audit = (result: 'ok' | 'refused' | 'error', detail: string) =>
      this.audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action: 'invoice.cancel',
        entity: invoiceId,
        result,
        detail,
      });

    let outcome: Awaited<ReturnType<InvoiceIssuer['cancel']>>;
    try {
      outcome = await issuer.cancel(invoice.accessKey, reason, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit('error', message);
      throw new HttpError(502, 'sefin_unavailable', message);
    }
    if (outcome.kind === 'rejected' && ALREADY_CANCELLED_CODES.includes(outcome.error.code)) {
      // The first cancel reached the Sefin, even if its answer did not reach us.
      this.invoices.markCancelled(ctx, invoiceId);
      audit('ok', 'already cancelled at the Sefin');
      return { id: invoiceId, status: 'cancelled', alreadyCancelled: true };
    }
    if (outcome.kind === 'rejected') {
      audit('refused', `${outcome.error.code} ${outcome.error.message}`);
      throw new HttpError(422, 'sefin_rejected', undefined, {
        code: outcome.error.code,
        message: outcome.error.message,
      });
    }
    const { event } = outcome;
    this.deps.db.transaction(() => {
      if (event) this.invoices.recordEvent(ctx, invoice.emitterId, event);
      // The event exists once the Sefin registered it, even when its XML was unreadable.
      this.invoices.markCancelled(ctx, invoiceId);
    });
    audit('ok', `reason ${reason}`);
    return { id: invoiceId, status: 'cancelled' };
  }

  // A built invoice resends its stored template as sent; it is never rebuilt from current records.
  private resendSource(
    ctx: AccountContext,
    state: { issueTemplate: string | null; templateOf: string | null; customerId: string | null },
  ): { source: IssueSource; customer?: InvoiceParty } {
    if (state.issueTemplate) return { source: { kind: 'built', template: state.issueTemplate } };
    if (!state.templateOf) throw new HttpError(409, 'not_unknown');
    const template = this.loadTemplate(ctx, state.templateOf);
    // The template's own customer is copied from its XML; only a chosen customer replaces it.
    const customer =
      state.customerId && state.customerId !== template.state.customerId
        ? this.customerParty(ctx, state.customerId)
        : undefined;
    return { source: { kind: 'stored', xml: template.xml }, ...(customer ? { customer } : {}) };
  }

  // The amount in reais of an export is the foreign amount at the PTAX sell rate of the competence date.
  private async checkPtax(
    currencyCode: string,
    competence: string,
    foreignCents: number,
    serviceCents: number,
  ): Promise<string> {
    const currency = BACEN_CURRENCY[currencyCode];
    if (!currency) throw new HttpError(400, 'unsupported_currency');
    let rate;
    try {
      rate = await this.deps.exchangeRate(currency, competence);
    } catch (error) {
      throw new HttpError(
        502,
        'ptax_unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
    const expectedCents = convertToCents(foreignCents, rate.rateE4);
    const rateText = (rate.rateE4 / 10_000).toFixed(4);
    if (serviceCents !== expectedCents) {
      throw new HttpError(400, 'amount_ptax_mismatch', undefined, {
        expectedCents,
        rate: rateText,
        rateDate: rate.date,
      });
    }
    return `PTAX ${rateText} of ${rate.date}`;
  }

  private async send(
    issuer: InvoiceIssuer,
    request: Parameters<InvoiceIssuer['issue']>[0],
  ): Promise<IssueOutcome> {
    try {
      return await issuer.issue(request);
    } catch (error) {
      // Whatever failed, the DPS may have reached the Sefin; reconciliation finds out.
      return { kind: 'uncertain', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private record(
    ctx: AccountContext,
    actor: string,
    action: string,
    invoiceId: string,
    emitterId: string,
    outcome: IssueOutcome,
  ): IssueResultView {
    const audit = (result: 'ok' | 'refused' | 'error', detail: string) =>
      this.audit.record({
        userEmail: actor,
        accountId: ctx.accountId,
        action,
        entity: invoiceId,
        result,
        detail,
      });
    if (outcome.kind === 'issued') {
      const { invoice } = outcome;
      // E0014 on a fresh number means another system used it; its invoice is not ours.
      const row = this.invoices.issueState(ctx, invoiceId);
      // A direct 201 answers our own DPS; only an invoice found by DPS id can be another one.
      if (outcome.recovered && (!row || !isOwnInvoice(row, invoice))) {
        const errors = [{ code: 'E0014', message: DPS_NUMBER_TAKEN }];
        this.invoices.markRejected(ctx, invoiceId, errors);
        audit('refused', `dps number taken by ${invoice.accessKey}`);
        return { id: invoiceId, status: 'rejected', errors };
      }
      try {
        this.deps.db.transaction(() => {
          this.invoices.markIssued(ctx, invoiceId, invoice);
          if (invoice.customer) this.customers.upsertImported(ctx, emitterId, invoice.customer);
        });
      } catch (error) {
        // The Sefin issued it; the row stays pending, and reconcile or the sync records it.
        const message = error instanceof Error ? error.message : String(error);
        try {
          audit('error', `issued ${invoice.accessKey}, local save failed: ${message}`);
        } catch {
          // The database is failing; the pending row still leads to reconcile.
        }
        return { id: invoiceId, status: 'unknown' };
      }
      audit('ok', `issued ${invoice.accessKey}`);
      return {
        id: invoiceId,
        status: 'issued',
        number: invoice.number,
        accessKey: invoice.accessKey,
      };
    }
    if (outcome.kind === 'rejected') {
      this.invoices.markRejected(ctx, invoiceId, outcome.errors);
      audit('refused', outcome.errors.map((e) => e.code).join(', '));
      return { id: invoiceId, status: 'rejected', errors: outcome.errors };
    }
    this.invoices.markUnknown(ctx, invoiceId, outcome.reason);
    audit('error', `uncertain: ${outcome.reason}`);
    return { id: invoiceId, status: 'unknown' };
  }

  private loadTemplate(ctx: AccountContext, invoiceId: string) {
    const state = this.invoices.issueState(ctx, invoiceId);
    if (!state) throw new HttpError(404, 'not_found');
    const xml =
      state.status === 'issued' || state.status === 'cancelled'
        ? this.invoices.xml(ctx, invoiceId)
        : null;
    if (!xml) throw new HttpError(409, 'template_not_issued');
    let template: DpsTemplate;
    try {
      template = readTemplate(xml);
    } catch (error) {
      if (error instanceof TemplateUnsupportedError) {
        throw new HttpError(422, 'template_unsupported', undefined, { paths: error.paths });
      }
      throw error;
    }
    return { state, xml, template };
  }

  private customerParty(ctx: AccountContext, customerId: string): InvoiceParty {
    const row = this.customers.get(ctx, customerId);
    if (!row) throw new HttpError(404, 'customer_not_found');
    return partyOf(row);
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

// dhEmi is now minus 60 seconds, so the competence is checked against that date in Brasília.
function checkCompetence(competence: string, now: Date): void {
  if (!isCalendarDate(competence)) throw new HttpError(400, 'invalid_competence');
  if (competence > formatBrasiliaDate(new Date(now.getTime() - 60_000))) {
    throw new HttpError(400, 'competence_after_issue');
  }
}

function checkDescription(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  const clean = xsdDescription(description);
  if (clean === null) throw new HttpError(400, 'invalid_description');
  return clean;
}

export function partyOf(row: CustomerRow): InvoiceParty {
  return {
    document:
      row.documentType === 'NONE' || !row.document
        ? null
        : { type: row.documentType, value: row.document },
    name: row.name,
    ...(row.municipalRegistration ? { municipalRegistration: row.municipalRegistration } : {}),
    ...(row.address ? { address: row.address as PartyAddress } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
  };
}
