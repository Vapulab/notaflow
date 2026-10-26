import type { InvoiceProvider, ProviderInvoice, SyncBatch, SyncDocument } from '@notaflow/core';
import { type DfeDocument, type NacionalClient, NacionalHttpError } from './http/NacionalClient';
import { parseEventXml } from './parse/parseEventXml';
import { parseNfseXml } from './parse/parseNfseXml';
import { NfseParseError } from './xml/readXml';

export class NacionalProvider implements InvoiceProvider {
  constructor(
    private readonly client: NacionalClient,
    private readonly emitterCnpj: string,
  ) {}

  async checkConnection(municipality: string): Promise<void> {
    await this.client.checkConvenio(municipality);
  }

  async fetchSince(nsu: number): Promise<SyncBatch> {
    const batch = await this.client.fetchDfe(nsu, this.emitterCnpj);
    if (batch.status === 'REJEICAO') throw new NacionalHttpError(400, false, batch.errors);
    // The ADN manual does not say whether /DFe/{NSU} includes NSU itself, so drop it either way.
    const fresh = batch.documents.filter((document) => document.nsu > nsu);
    return {
      documents: fresh.map((document) => this.toSyncDocument(document)),
      lastNsu: fresh.reduce((last, document) => Math.max(last, document.nsu), nsu),
      hasMore: fresh.length > 0,
    };
  }

  async getInvoice(accessKey: string): Promise<ProviderInvoice | null> {
    try {
      return parseNfseXml(await this.client.getNfse(accessKey));
    } catch (error) {
      if (error instanceof NacionalHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private toSyncDocument(document: DfeDocument): SyncDocument {
    const { nsu } = document;
    try {
      if (document.type === 'NFSE') {
        const invoice = parseNfseXml(document.xml);
        if (invoice.provider.cnpj !== this.emitterCnpj) {
          return { kind: 'skipped', nsu, reason: 'received invoice' };
        }
        return { kind: 'invoice', nsu, invoice };
      }
      if (document.type === 'EVENTO') {
        const event = parseEventXml(document.xml);
        // The key holds the issuer CNPJ after municipality (7), environment (1), and type (1).
        if (event.accessKey.slice(9, 23) !== this.emitterCnpj) {
          return { kind: 'skipped', nsu, reason: 'received invoice event' };
        }
        return { kind: 'event', nsu, event };
      }
      return { kind: 'skipped', nsu, reason: `document type ${document.type}` };
    } catch (error) {
      if (error instanceof NfseParseError) {
        return { kind: 'skipped', nsu, reason: `parse error: ${error.message}` };
      }
      throw error;
    }
  }
}
