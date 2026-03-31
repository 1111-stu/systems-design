import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { loadEnv } from './load-env.js';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

const getDatabaseUrl = () => {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  return databaseUrl;
};

export const getPool = () => {
  if (pool) return pool;
  pool = new Pool({ connectionString: getDatabaseUrl() });
  return pool;
};

export const getDb = () => {
  if (db) return db;
  db = drizzle(getPool(), { schema });
  return db;
};

export { schema };
