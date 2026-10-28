import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { adminOf, seedTenant, seedUser } from '../../test/fixtures';
import { type Database, openDatabase } from '../db/openDatabase';
import { sealCertificate } from '../vault/envelope';
import { AdminRepository } from './AdminRepository';
import { AuditLog } from './AuditLog';
import { CertificateRepository } from './CertificateRepository';
import { EmitterRepository } from './EmitterRepository';
import { IdentityRepository } from './IdentityRepository';
import { MemberRepository } from './MemberRepository';

let db: Database;
let close: () => void;

beforeEach(() => {
  ({ db, close } = openDatabase(':memory:'));
});
afterEach(() => close());

const newEmitter = {
  cnpj: '12345678000195',
  companyName: 'EMPRESA TESTE LTDA',
  municipality: '3550308',
  simplesNacional: '1' as const,
  specialRegime: '0',
  dpsSeries: '900',
};
const certMeta = {
  cnpj: '12345678000195',
  subject: 'CN=EMPRESA TESTE LTDA:12345678000195',
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2027-01-01T00:00:00Z'),
  fingerprintSha256: 'ab'.repeat(32),
  uploadedBy: '',
};

describe('IdentityRepository', () => {
  test('finds a user by email in any case, with memberships', () => {
    const a = seedTenant(db, { accountName: 'Vapulab', email: 'lincoln@example.com' });
    const identity = new IdentityRepository(db).findByEmail('Lincoln@Example.COM');
    expect(identity).toMatchObject({
      userId: a.userId,
      email: 'lincoln@example.com',
      platformRole: 'user',
      memberships: [
        { accountId: a.accountId, accountName: 'Vapulab', role: 'owner', accountStatus: 'active' },
      ],
    });
  });

  test('an unknown email is null', () => {
    expect(new IdentityRepository(db).findByEmail('nobody@example.com')).toBeNull();
  });
});

describe('EmitterRepository and CertificateRepository isolation', () => {
  test('an account never reads or changes another account emitter', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    const emitters = new EmitterRepository(db);
    const emitter = emitters.create(a, newEmitter);
    expect(emitter.environment).toBe('producao_restrita');
    expect(emitters.list(a)).toHaveLength(1);
    expect(emitters.list(b)).toEqual([]);
    expect(emitters.get(b, emitter.id)).toBeNull();
    expect(emitters.setEnvironment(b, emitter.id, 'producao')).toBe(false);
    expect(emitters.get(a, emitter.id)?.environment).toBe('producao_restrita');
  });

  test('isCnpjTakenElsewhere is true only for a CNPJ of another account', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    new EmitterRepository(db).create(a, newEmitter);
    expect(new EmitterRepository(db).isCnpjTakenElsewhere(b, '12345678000195')).toBe(true);
    expect(new EmitterRepository(db).isCnpjTakenElsewhere(a, '12345678000195')).toBe(false);
  });

  test('a new active certificate deactivates the previous one, and other accounts see none', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'a@example.com' });
    const b = seedTenant(db, { accountName: 'B', email: 'b@example.com' });
    const emitter = new EmitterRepository(db).create(a, newEmitter);
    const certs = new CertificateRepository(db);
    const sealed = sealCertificate(Buffer.from('pfx'), 'senha', Buffer.alloc(32, 1), emitter.id);
    const first = certs.addActive(a, emitter.id, sealed, { ...certMeta, uploadedBy: a.userId });
    const second = certs.addActive(a, emitter.id, sealed, { ...certMeta, uploadedBy: a.userId });
    expect(certs.activeFor(a, emitter.id)?.id).toBe(second);
    expect(certs.activeFor(a, emitter.id)?.id).not.toBe(first);
    expect(certs.activeFor(b, emitter.id)).toBeNull();
    expect(() =>
      certs.addActive(b, emitter.id, sealed, { ...certMeta, uploadedBy: b.userId }),
    ).toThrow(/not found/);
  });
});

describe('MemberRepository', () => {
  test('invite creates the user once and adds a member', () => {
    const a = seedTenant(db, { accountName: 'A', email: 'owner@example.com' });
    const members = new MemberRepository(db);
    const first = members.invite(a, 'New@Example.com', 'New');
    expect(first).toMatchObject({ created: true });
    expect(members.invite(a, 'new@example.com', 'New')).toBeNull();
    expect(members.list(a).map((m) => [m.email, m.role])).toEqual(
      expect.arrayContaining([
        ['owner@example.com', 'owner'],
        ['new@example.com', 'member'],
      ]),
    );
  });
});

describe('AdminRepository', () => {
  test('creates accounts and users, sets memberships, and suspends', () => {
    const admin = adminOf(seedUser(db, 'admin@example.com', 'admin'));
    const repo = new AdminRepository(db);
    const accountId = repo.createAccount(admin, 'Vapulab');
    const userId = repo.createUser(admin, 'Owner@Example.com', 'Owner');
    expect(userId).toEqual(expect.any(String));
    expect(repo.createUser(admin, 'owner@example.com', 'Again')).toBeNull();
    expect(repo.setMembership(admin, accountId, userId ?? '', 'owner')).toBe(true);
    expect(repo.setAccountStatus(admin, accountId, 'suspended')).toBe(true);
    expect(repo.setAccountStatus(admin, 'missing', 'suspended')).toBe(false);
    expect(repo.listAccounts(admin)).toEqual([
      expect.objectContaining({ id: accountId, name: 'Vapulab', status: 'suspended', members: 1 }),
    ]);
  });
});

test('setPlatformRole makes a user a platform admin', () => {
  const admin = adminOf(seedUser(db, 'admin@example.com', 'admin'));
  const userId = seedUser(db, 'user@example.com');
  expect(new AdminRepository(db).setPlatformRole(admin, userId, 'admin')).toBe(true);
  expect(new IdentityRepository(db).findByEmail('user@example.com')?.platformRole).toBe('admin');
});

describe('AuditLog', () => {
  test('records entries in order', () => {
    const log = new AuditLog(db);
    log.record({
      userEmail: 'a@example.com',
      accountId: null,
      action: 'account.create',
      entity: 'x',
      result: 'ok',
    });
    log.record({
      userEmail: 'a@example.com',
      accountId: null,
      action: 'user.create',
      entity: 'y',
      result: 'refused',
      detail: 'exists',
    });
    expect(log.list().map((e) => [e.action, e.result])).toEqual([
      ['account.create', 'ok'],
      ['user.create', 'refused'],
    ]);
    expect(log.latest(1).map((e) => e.action)).toEqual(['user.create']);
  });
});
