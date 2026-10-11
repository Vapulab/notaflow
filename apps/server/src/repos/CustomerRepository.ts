import { randomUUID } from 'node:crypto';
import type { AccountContext, InvoiceParty, PartyAddress } from '@notaflow/core';
import { and, eq, like, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { created, notDeleted, touched } from '../db/stamps';
import { customers, emitters } from '../db/schema';

export type CustomerRow = typeof customers.$inferSelect;
export type ManualField = 'name' | 'email' | 'phone' | 'municipalRegistration' | 'address';

export interface NewCustomer {
  documentType: 'CNPJ' | 'CPF' | 'NIF' | 'NONE';
  document: string | null;
  name: string;
  municipalRegistration?: string;
  email?: string;
  phone?: string;
  address: PartyAddress;
}

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  upsertImported(ctx: AccountContext, emitterId: string, party: InvoiceParty): string | null {
    if (!party.document) return null;
    this.requireEmitter(ctx, emitterId);
    const { type, value } = party.document;
    const imported = {
      name: party.name,
      email: party.email ?? null,
      phone: party.phone ?? null,
      municipalRegistration: party.municipalRegistration ?? null,
      address: party.address ?? null,
    };
    const existing = this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.emitterId, emitterId),
          eq(customers.documentType, type),
          eq(customers.document, value),
          notDeleted(customers),
        ),
      )
      .get();
    if (!existing) {
      const id = randomUUID();
      this.db
        .insert(customers)
        .values({
          ...created(ctx),
          id,
          emitterId,
          documentType: type,
          document: value,
          origin: 'imported',
          ...imported,
        })
        .run();
      return id;
    }
    const kept = new Set(existing.manualFields);
    const changes = Object.fromEntries(
      Object.entries(imported).filter(([field]) => !kept.has(field)),
    );
    this.db
      .update(customers)
      .set({ ...changes, ...touched(ctx) })
      .where(eq(customers.id, existing.id))
      .run();
    return existing.id;
  }

  // null when the emitter already has a customer with this document.
  createManual(ctx: AccountContext, emitterId: string, input: NewCustomer): CustomerRow | null {
    this.requireEmitter(ctx, emitterId);
    if (input.document !== null) {
      const existing = this.db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.emitterId, emitterId),
            eq(customers.documentType, input.documentType),
            eq(customers.document, input.document),
            notDeleted(customers),
          ),
        )
        .get();
      if (existing) return null;
    }
    const typed = {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      municipalRegistration: input.municipalRegistration ?? null,
      address: input.address,
    };
    // Every typed field is manual, so a later sync of the same document keeps it.
    const manualFields = Object.entries(typed)
      .filter(([, value]) => value !== null)
      .map(([field]) => field);
    return this.db
      .insert(customers)
      .values({
        ...created(ctx),
        id: randomUUID(),
        emitterId,
        documentType: input.documentType,
        document: input.document,
        origin: 'manual',
        manualFields,
        ...typed,
      })
      .returning()
      .get();
  }

  setManual(
    ctx: AccountContext,
    customerId: string,
    fields: Partial<Pick<CustomerRow, ManualField>>,
  ): boolean {
    const row = this.get(ctx, customerId);
    if (!row) return false;
    const manualFields = [...new Set([...row.manualFields, ...Object.keys(fields)])];
    this.db
      .update(customers)
      .set({ ...fields, manualFields, ...touched(ctx) })
      .where(eq(customers.id, customerId))
      .run();
    return true;
  }

  list(ctx: AccountContext, filter: { emitterId?: string; search?: string }): CustomerRow[] {
    const conditions: SQL[] = [
      eq(emitters.accountId, ctx.accountId),
      notDeleted(emitters),
      eq(customers.archived, false),
      notDeleted(customers),
    ];
    if (filter.emitterId) conditions.push(eq(customers.emitterId, filter.emitterId));
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(like(customers.name, pattern), like(customers.document, pattern));
      if (match) conditions.push(match);
    }
    return this.db
      .select({ customer: customers })
      .from(customers)
      .innerJoin(emitters, eq(emitters.id, customers.emitterId))
      .where(and(...conditions))
      .orderBy(customers.name)
      .all()
      .map((row) => row.customer);
  }

  get(ctx: AccountContext, customerId: string): CustomerRow | null {
    const row = this.db
      .select({ customer: customers })
      .from(customers)
      .innerJoin(emitters, eq(emitters.id, customers.emitterId))
      .where(
        and(
          eq(customers.id, customerId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
          notDeleted(customers),
        ),
      )
      .get();
    return row?.customer ?? null;
  }

  private requireEmitter(ctx: AccountContext, emitterId: string): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(
        and(
          eq(emitters.id, emitterId),
          eq(emitters.accountId, ctx.accountId),
          notDeleted(emitters),
        ),
      )
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
  }
}
