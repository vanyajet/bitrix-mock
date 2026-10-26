import type { Pool } from '../pool.js';

export interface SegmentOption {
  vertical: string;
  segment: string;
  leads: number;
}

export async function segmentOptions(pool: Pool): Promise<SegmentOption[]> {
  const { rows } = await pool.query<SegmentOption>(
    `SELECT vertical, segment, count(*)::int AS leads
     FROM leads WHERE segment IS NOT NULL
     GROUP BY vertical, segment
     ORDER BY vertical, leads DESC`,
  );
  return rows;
}

export async function sourceNames(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ code: string; name: string }>('SELECT code, name FROM sources');
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}

export async function userNames(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ bitrix_id: number; name: string }>('SELECT bitrix_id, name FROM users');
  return Object.fromEntries(rows.map((r) => [String(r.bitrix_id), r.name]));
}
