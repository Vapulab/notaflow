import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { AccountContext } from '@notaflow/core';
import type { Database } from '../db/openDatabase';
import { accountDocuments } from '../db/schema';
import { created } from '../db/stamps';

export class AccountDocumentRepository {
  constructor(private readonly db: Database) {}

  addCnpjCard(
    ctx: AccountContext,
    input: { cnpj: string; fileName: string; content: Buffer },
  ): string {
    const id = randomUUID();
    this.db
      .insert(accountDocuments)
      .values({
        ...created(ctx),
        id,
        accountId: ctx.accountId,
        kind: 'cnpj_card',
        cnpj: input.cnpj,
        fileName: input.fileName,
        contentGzip: gzipSync(input.content),
        sha256: createHash('sha256').update(input.content).digest('hex'),
        sizeBytes: input.content.length,
      })
      .run();
    return id;
  }
}
