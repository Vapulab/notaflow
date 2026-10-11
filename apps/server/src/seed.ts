import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { type Database, openDatabase } from './db/openDatabase';
import { users } from './db/schema';
import { created, touched } from './db/stamps';

// Runs before any user exists, so it writes the users table directly.
export function seedAdmin(
  db: Database,
  email: string,
  name: string,
): { userId: string; created: boolean } {
  const normalized = email.toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, normalized)).get();
  if (existing) {
    db.update(users)
      .set({ platformRole: 'admin', ...touched(null) })
      .where(eq(users.id, existing.id))
      .run();
    return { userId: existing.id, created: false };
  }
  const userId = randomUUID();
  db.insert(users)
    .values({ ...created(null), id: userId, email: normalized, name, platformRole: 'admin' })
    .run();
  return { userId, created: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [email, name] = process.argv.slice(2);
  const path = process.env.DATABASE_PATH;
  if (!email || !name || !path) {
    console.error('Usage: pnpm seed:admin <email> <name>, with DATABASE_PATH set');
    process.exit(1);
  }
  const { db, close } = openDatabase(path);
  console.log(
    seedAdmin(db, email, name).created ? 'Admin created.' : 'Existing user is now an admin.',
  );
  close();
}
