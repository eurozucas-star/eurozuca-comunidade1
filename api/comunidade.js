// Vercel Function: /api/comunidade?action=...
// Precisa da variável de ambiente DATABASE_URL (ligação Postgres do Supabase, modo "Transaction pooler", porta 6543).
import pg from 'pg';
import { createComunidade } from '../lib/comunidade.js';

function connectionString() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  // O pg trata sslmode=require como verificação completa; o Supabase usa uma CA própria.
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  return url.toString();
}

let handler;
function getHandler() {
  if (handler) return handler;
  const cs = connectionString();
  if (!cs) return null;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(cs);
  const pool = new pg.Pool({
    connectionString: cs,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  const db = { query: (text, params) => pool.query(text, params), exec: (text) => pool.query(text) };
  handler = createComunidade(db, { secureCookies: !local });
  return handler;
}

export default async function comunidade(req, res) {
  const h = getHandler();
  if (!h) {
    console.error('[comunidade] Falta a variável DATABASE_URL');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'O serviço ainda não está configurado.' }));
  }
  return h(req, res);
}
