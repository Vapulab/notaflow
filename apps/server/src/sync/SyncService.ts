import type { AccountContext, CertificateStore, Environment } from '@notaflow/core';
import { NacionalHttpError } from '@notaflow/provider-nacional';
import type { Database } from '../db/openDatabase';
import type { ProviderFactory } from '../providers/providerFactory';
import { CustomerRepository } from '../repos/CustomerRepository';
import { ServiceRepository } from '../repos/ServiceRepository';
import { EmitterRepository } from '../repos/EmitterRepository';
import { InvoiceRepository } from '../repos/InvoiceRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { type ApplyCounts, applyDocument } from './applyDocument';

export interface SyncResult extends ApplyCounts {
  environment: Environment;
  batches: number;
  lastNsu: number;
  error: string | null;
}

export class SyncBusyError extends Error {
  constructor() {
    super('This emitter is already syncing.');
    this.name = 'SyncBusyError';
  }
}

export class SyncService {
  private readonly running = new Set<string>();
  private readonly emitters: EmitterRepository;
  private readonly customers: CustomerRepository;
  private readonly services: ServiceRepository;
  private readonly invoices: InvoiceRepository;
  private readonly state: SyncStateRepository;

  constructor(
    private readonly deps: {
      db: Database;
      certificates: CertificateStore;
      providerFactory: ProviderFactory;
      retryDelaysMs?: number[];
      maxBatches?: number;
      now?: () => Date;
    },
  ) {
    this.emitters = new EmitterRepository(deps.db);
    this.customers = new CustomerRepository(deps.db);
    this.services = new ServiceRepository(deps.db);
    this.invoices = new InvoiceRepository(deps.db);
    this.state = new SyncStateRepository(deps.db);
  }

  isRunning(emitterId: string): boolean {
    return this.running.has(emitterId);
  }

  async syncEmitter(ctx: AccountContext, emitterId: string): Promise<SyncResult> {
    if (this.running.has(emitterId)) throw new SyncBusyError();
    this.running.add(emitterId);
    try {
      return await this.run(ctx, emitterId);
    } finally {
      this.running.delete(emitterId);
    }
  }

  private async run(ctx: AccountContext, emitterId: string): Promise<SyncResult> {
    const emitter = this.emitters.get(ctx, emitterId);
    if (!emitter) throw new Error('Emitter not found in this account.');
    const environment = emitter.environment;
    const result: SyncResult = {
      environment,
      batches: 0,
      invoices: 0,
      events: 0,
      skipped: 0,
      lastNsu: this.state.get(ctx, emitterId, environment).lastNsu,
      error: null,
    };
    try {
      const certificate = await this.deps.certificates.loadActive(ctx, emitterId);
      if (!certificate) throw new Error('no active certificate');
      const provider = this.deps.providerFactory({ environment, certificate });
      for (let n = 0; n < (this.deps.maxBatches ?? 200); n++) {
        const batch = await this.withRetry(() => provider.fetchSince(result.lastNsu));
        this.deps.db.transaction(() => {
          for (const document of batch.documents) {
            applyDocument(
              { customers: this.customers, invoices: this.invoices, services: this.services },
              ctx,
              emitterId,
              document,
              result,
            );
          }
          this.state.saveCursor(ctx, emitterId, environment, batch.lastNsu);
        });
        result.batches++;
        result.lastNsu = batch.lastNsu;
        if (!batch.hasMore) break;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    this.state.recordRun(ctx, emitterId, environment, { at: this.now(), error: result.error });
    return result;
  }

  private async withRetry<T>(call: () => Promise<T>): Promise<T> {
    const delays = this.deps.retryDelaysMs ?? [1000, 5000, 15000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        const retryable = !(error instanceof NacionalHttpError) || error.retryable;
        const delay = delays[attempt];
        if (!retryable || delay === undefined) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
