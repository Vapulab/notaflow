import type {
  CancelOutcome,
  CertificateMaterial,
  InvoiceIssuer,
  IssueOutcome,
  IssueRequest,
  IssueSource,
  NewInvoiceInput,
  ProviderEvent,
  ProviderInvoice,
} from '@notaflow/core';
import { NodeSigner } from '@notaflow/signer-node';
import { buildDpsId } from './dps/buildDpsId';
import { buildDpsXml } from './dps/buildDpsXml';
import type { Environment } from './dps/types';
import { buildCancelEventXml } from './events/buildCancelEventXml';
import { isDuplicateDps, type NacionalClient } from './http/NacionalClient';
import { parseEventXml } from './parse/parseEventXml';
import { parseNfseXml } from './parse/parseNfseXml';
import { applyTemplate } from './template/applyTemplate';
import { buildTemplate } from './template/buildTemplate';
import { type DpsTemplate, readTemplate } from './template/readTemplate';

export class NacionalIssuer implements InvoiceIssuer {
  private readonly signer = new NodeSigner();

  constructor(
    private readonly deps: {
      client: NacionalClient;
      certificate: CertificateMaterial;
      environment: Environment;
      appVersion: string;
    },
  ) {}

  buildTemplate(input: NewInvoiceInput): string {
    return JSON.stringify(buildTemplate(input));
  }

  dpsId(series: string, number: number, source: IssueSource): string {
    const template = templateOf(source);
    return buildDpsId({ municipality: template.emitterMunicipality, cnpj: template.provider.cnpj, series, number });
  }

  async issue(request: IssueRequest): Promise<IssueOutcome> {
    const input = applyTemplate(templateOf(request.source), {
      ...request,
      environment: this.deps.environment,
      appVersion: this.deps.appVersion,
    });
    const { id, xml } = buildDpsXml(input);
    const signed = await this.signer.sign({
      xml,
      elementName: 'infDPS',
      certificate: this.deps.certificate,
      profile: 'rsa-sha256-exc-c14n',
    });
    const result = await this.deps.client.issue(signed);
    if (result.kind === 'issued') return { kind: 'issued', invoice: parseNfseXml(result.nfseXml) };
    if (result.kind === 'uncertain') return { kind: 'uncertain', reason: result.reason };
    if (isDuplicateDps(result.errors)) {
      const existing = await this.findIssued(id);
      return existing
        ? { kind: 'issued', invoice: existing, recovered: true }
        : { kind: 'uncertain', reason: 'E0014 but no NFS-e found for the DPS' };
    }
    return {
      kind: 'rejected',
      errors: result.errors.map((e) => ({ code: e.codigo, message: e.descricao })),
    };
  }

  async findIssued(dpsId: string): Promise<ProviderInvoice | null> {
    const lookup = await this.deps.client.findByDpsId(dpsId);
    if (lookup.kind === 'not_found') return null;
    return parseNfseXml(await this.deps.client.getNfse(lookup.accessKey));
  }

  async cancel(accessKey: string, reason: '1' | '2' | '9', justification: string): Promise<CancelOutcome> {
    const { xml } = buildCancelEventXml({
      environment: this.deps.environment,
      requestedAt: new Date(Date.now() - 60_000),
      appVersion: this.deps.appVersion,
      authorCnpj: this.deps.certificate.cnpj,
      accessKey,
      reason,
      justification,
    });
    const signed = await this.signer.sign({
      xml,
      elementName: 'infPedReg',
      certificate: this.deps.certificate,
      profile: 'rsa-sha256-exc-c14n',
    });
    const result = await this.deps.client.registerEvent(accessKey, signed);
    if (result.kind === 'rejected') {
      return { kind: 'rejected', error: { code: result.error.codigo, message: result.error.descricao } };
    }
    return { kind: 'cancelled', event: result.eventXml ? readEvent(result.eventXml) : null };
  }
}

function templateOf(source: IssueSource): DpsTemplate {
  return source.kind === 'stored' ? readTemplate(source.xml) : (JSON.parse(source.template) as DpsTemplate);
}

// The Sefin registered the event; an XML the parser cannot read must not hide that.
function readEvent(xml: string): ProviderEvent | null {
  try {
    return parseEventXml(xml);
  } catch {
    return null;
  }
}
