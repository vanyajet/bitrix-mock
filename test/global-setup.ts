import pg from 'pg';
import { TEST_DATABASE_URL } from './helpers/config.js';

/** Создаёт тестовую базу рядом с основной (по умолчанию в postgres из docker compose). */
export default async function setup(): Promise<void> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const dbName = decodeURIComponent(adminUrl.pathname.slice(1));
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Tests need PostgreSQL at ${TEST_DATABASE_URL} (${(err as Error).message}). Start it with: docker compose up -d db`,
      { cause: err },
    );
  }
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}
