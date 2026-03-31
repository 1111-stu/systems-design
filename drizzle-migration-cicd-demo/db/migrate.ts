import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb, getPool } from './index.js';

async function runMigrate() {
  console.log('Running database migrations...');
  await migrate(getDb(), { migrationsFolder: './drizzle' });
  console.log('Migrations completed');
  await getPool().end();
  process.exit(0);
}

runMigrate().catch(async (error) => {
  console.error('Migration failed:', error);
  await getPool().end().catch(() => undefined);
  process.exit(1);
});
