import { createServer } from 'node:http';
import { sql } from 'drizzle-orm';
import { getDb, getPool } from '../db/index.js';
import { users } from '../db/schema/index.js';

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (_req, res) => {
  try {
    const db = getDb();
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users);

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        message: 'app is running',
        usersCount: Number(count),
      })
    );
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: false,
        message: error instanceof Error ? error.message : 'unknown error',
      })
    );
  }
});

server.listen(port, () => {
  console.log(`Server listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', async () => {
  server.close();
  await getPool().end().catch(() => undefined);
  process.exit(0);
});
