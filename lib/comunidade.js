// Lógica do diretório da comunidade Eurozuca.
// Recebe um objeto `db` com query(text, params) -> {rows} e exec(text).
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { SCHEMA } from './schema.js';

export const CATEGORIES = ['Restaurantes','Advogados','Contabilistas','Saúde','Beleza','Imobiliária',
  'Educação','Transportes','Mercadorias','Serviços','Eventos','Tecnologia'];
const PAGE_SIZE = 12;
const SESSION_DAYS = 30;
const COOKIE = 'ez_session';
const MAX_ACTIVE_LISTINGS = 20;
const MAX_PUBLISH_PER_DAY = 10;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- utilitários ----------
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max + 1);
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max + 1);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}
// Hash usado quando o e-mail não existe, para o tempo de resposta ser igual.
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const publicUser = (row) => ({ name: row.name, kind: row.kind, plan: row.plan });

// ---------- criação ----------
export function createComunidade(db, { secureCookies = true } = {}) {
  let ready = null;
  const ensureSchema = () => (ready ??= db.exec(SCHEMA).catch((e) => { ready = null; throw e; }));

  function sessionCookie(token, maxAgeSeconds) {
    return [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`, secureCookies ? 'Secure' : '']
      .filter(Boolean).join('; ');
  }

  async function startSession(accountId) {
    const token = randomBytes(32).toString('base64url');
    await db.query(
      `insert into ez_sessions (token_hash, account_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`,
      [sha256(token), accountId, String(SESSION_DAYS)]);
    // limpeza ocasional de sessões expiradas
    if (Math.random() < 0.05) await db.query(`delete from ez_sessions where expires_at < now()`);
    return token;
  }

  function readToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    return parseCookies(req.headers['cookie'])[COOKIE] || null;
  }

  async function currentUser(req, required = true) {
    const token = readToken(req);
    if (token && token.length < 200) {
      const { rows } = await db.query(
        `select a.id, a.name, a.kind, a.plan, a.status from ez_sessions s join ez_accounts a on a.id = s.account_id
         where s.token_hash = $1 and s.expires_at > now()`, [sha256(token)]);
      if (rows[0] && rows[0].status === 'active') return rows[0];
    }
    if (required) fail(401, 'Sessão terminada. Entre novamente na sua conta.');
    return null;
  }

  async function tooManyAttempts(ip, email) {
    const { rows } = await db.query(
      `select count(*) filter (where ip = $1)::int as by_ip, count(*) filter (where email = $2)::int as by_email
       from ez_login_attempts where created_at > now() - interval '15 minutes'`, [ip, email]);
    return rows[0].by_ip >= 20 || rows[0].by_email >= 6;
  }
  const recordAttempt = (ip, email) => db.query(`insert into ez_login_attempts (ip, email) values ($1, $2)`, [ip, email]);

  // ---------- ações ----------
  const actions = {
    async register({ body, ip }) {
      const kind = body.kind === 'company' ? 'company' : body.kind === 'person' ? 'person' : fail(400, 'Escolha o tipo de conta.');
      const name = clean(body.name, 90);
      const email = clean(body.email, 200).toLowerCase();
      const password = String(body.password ?? '');
      if (name.length < 2 || name.length > 90) fail(400, 'O nome público deve ter entre 2 e 90 caracteres.');
      if (!EMAIL_RE.test(email) || email.length > 200) fail(400, 'Indique um e-mail válido.');
      if (password.length < 10 || password.length > 128) fail(400, 'A palavra-passe deve ter entre 10 e 128 caracteres.');
      if (body.agree !== true) fail(400, 'Confirme que leu o aviso para criar a conta.');
      if (await tooManyAttempts(ip, email)) fail(429, 'Demasiadas tentativas. Aguarde alguns minutos.');
      await recordAttempt(ip, email);
      const { rows } = await db.query(
        `insert into ez_accounts (kind, name, email, password_hash) values ($1, $2, $3, $4)
         on conflict (email) do nothing returning id, name, kind, plan`, [kind, name, email, hashPassword(password)]);
      if (!rows[0]) fail(409, 'Já existe uma conta com este e-mail. Escolha "Entrar".');
      const token = await startSession(rows[0].id);
      return { status: 201, body: { user: publicUser(rows[0]), token }, cookie: sessionCookie(token, SESSION_DAYS * 86400) };
    },

    async login({ body, ip }) {
      const email = clean(body.email, 200).toLowerCase();
      const password = String(body.password ?? '').slice(0, 128);
      if (!email || !password) fail(400, 'Indique o e-mail e a palavra-passe.');
      if (await tooManyAttempts(ip, email)) fail(429, 'Demasiadas tentativas. Aguarde alguns minutos.');
      const { rows } = await db.query(`select id, name, kind, plan, status, password_hash from ez_accounts where email = $1`, [email]);
      const ok = verifyPassword(password, rows[0]?.password_hash ?? DUMMY_HASH) && !!rows[0];
      if (!ok) { await recordAttempt(ip, email); fail(401, 'E-mail ou palavra-passe incorretos.'); }
      if (rows[0].status !== 'active') fail(403, 'Esta conta está suspensa. Contacte a Eurozuca.');
      const token = await startSession(rows[0].id);
      return { body: { user: publicUser(rows[0]), token }, cookie: sessionCookie(token, SESSION_DAYS * 86400) };
    },

    async logout({ req }) {
      const token = readToken(req);
      if (token) await db.query(`delete from ez_sessions where token_hash = $1`, [sha256(token)]);
      return { body: { ok: true }, cookie: sessionCookie('', 0) };
    },

    async me({ req }) {
      const user = await currentUser(req);
      return { body: { user: publicUser(user) } };
    },

    async directory({ query }) {
      const kind = query.kind === 'request' ? 'request' : 'offer';
      const page = Math.min(Math.max(parseInt(query.page, 10) || 0, 0), 500);
      const q = clean(query.q, 100);
      const city = clean(query.city, 80);
      const category = CATEGORIES.includes(query.category) ? query.category : '';
      const where = [`l.status = 'active'`, `a.status = 'active'`, `l.kind = $1`];
      const params = [kind];
      if (q) {
        params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
        where.push(`(l.title ilike $${params.length} or l.description ilike $${params.length} or l.category ilike $${params.length})`);
      }
      if (city) { params.push(city); where.push(`lower(l.city) = lower($${params.length})`); }
      if (category) { params.push(category); where.push(`l.category = $${params.length}`); }
      params.push(PAGE_SIZE + 1, page * PAGE_SIZE);
      const list = await db.query(
        `select l.id, l.kind, l.title, l.category, l.city, l.description, l.whatsapp, l.created_at,
                a.name as account_name, a.kind as account_kind
         from ez_listings l join ez_accounts a on a.id = l.account_id
         where ${where.join(' and ')}
         order by (a.plan = 'premium') desc, (a.plan = 'empresa') desc, l.created_at desc, l.id desc
         limit $${params.length - 1} offset $${params.length}`, params);
      const stats = await db.query(
        `select count(*) filter (where l.kind = 'offer')::int as offers,
                count(*) filter (where l.kind = 'request')::int as requests,
                count(distinct l.account_id) filter (where a.kind = 'company')::int as companies,
                count(distinct lower(l.city))::int as cities
         from ez_listings l join ez_accounts a on a.id = l.account_id
         where l.status = 'active' and a.status = 'active'`);
      const counts = await db.query(
        `select l.category, count(*)::int as n from ez_listings l join ez_accounts a on a.id = l.account_id
         where l.status = 'active' and a.status = 'active' and l.kind = 'offer' group by l.category`);
      const cities = await db.query(
        `select min(l.city) as city from ez_listings l join ez_accounts a on a.id = l.account_id
         where l.status = 'active' and a.status = 'active' group by lower(l.city) order by 1 limit 200`);
      const items = list.rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, id: Number(r.id) }));
      return {
        body: {
          items,
          hasMore: list.rows.length > PAGE_SIZE,
          stats: stats.rows[0],
          counts: Object.fromEntries(counts.rows.map((r) => [r.category, r.n])),
          cities: cities.rows.map((r) => r.city),
        },
      };
    },

    async publish({ req, body }) {
      const user = await currentUser(req);
      const kind = body.kind === 'request' ? 'request' : body.kind === 'offer' ? 'offer' : fail(400, 'Escolha se oferece ou procura um serviço.');
      const title = clean(body.title, 100);
      const city = clean(body.city, 80);
      const description = cleanText(body.description, 1000);
      const category = CATEGORIES.includes(body.category) ? body.category : fail(400, 'Escolha uma categoria.');
      const whatsapp = String(body.whatsapp ?? '').replace(/\D/g, '').replace(/^00/, '');
      if (title.length < 4 || title.length > 100) fail(400, 'O título deve ter entre 4 e 100 caracteres.');
      if (city.length < 2 || city.length > 80) fail(400, 'Indique a cidade.');
      if (description.length < 15 || description.length > 1000) fail(400, 'A descrição deve ter entre 15 e 1000 caracteres.');
      if (whatsapp.length < 8 || whatsapp.length > 15) fail(400, 'Indique o WhatsApp com o código do país, por exemplo +351 912 345 678.');
      if (body.publicContact !== true) fail(400, 'Autorize a publicação do contacto para publicar o anúncio.');
      const { rows: [lim] } = await db.query(
        `select count(*) filter (where status = 'active')::int as active,
                count(*) filter (where created_at > now() - interval '1 day')::int as today
         from ez_listings where account_id = $1`, [user.id]);
      if (lim.active >= MAX_ACTIVE_LISTINGS) fail(429, `Atingiu o limite de ${MAX_ACTIVE_LISTINGS} anúncios ativos. Encerre um anúncio antigo.`);
      if (lim.today >= MAX_PUBLISH_PER_DAY) fail(429, 'Atingiu o limite de anúncios por dia. Tente amanhã.');
      const { rows } = await db.query(
        `insert into ez_listings (account_id, kind, title, category, city, description, whatsapp)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`, [user.id, kind, title, category, city, description, whatsapp]);
      return { status: 201, body: { ok: true, id: Number(rows[0].id) } };
    },

    async mine({ req }) {
      const user = await currentUser(req);
      const { rows } = await db.query(
        `select id, kind, title, category, city, status, created_at from ez_listings
         where account_id = $1 and status <> 'removed' order by created_at desc limit 100`, [user.id]);
      return { body: { items: rows.map((r) => ({ ...r, id: Number(r.id) })) } };
    },

    async close({ req, body }) {
      const user = await currentUser(req);
      const id = Number.parseInt(body.id, 10);
      if (!Number.isSafeInteger(id) || id <= 0) fail(400, 'Anúncio inválido.');
      const { rows } = await db.query(
        `update ez_listings set status = 'closed', closed_at = now()
         where id = $1 and account_id = $2 and status = 'active' returning id`, [id, user.id]);
      if (!rows[0]) fail(404, 'Anúncio não encontrado ou já encerrado.');
      return { body: { ok: true } };
    },
  };
  const METHODS = { register: 'POST', login: 'POST', logout: 'POST', publish: 'POST', close: 'POST', me: 'GET', directory: 'GET', mine: 'GET' };

  // ---------- handler HTTP (formato Vercel / Node) ----------
  return async function handler(req, res) {
    const send = (status, body, extra = {}) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', extra.cache || 'no-store');
      if (extra.cookie) res.setHeader('Set-Cookie', extra.cookie);
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://local');
      const query = Object.fromEntries(url.searchParams);
      const action = query.action;
      if (!Object.hasOwn(METHODS, action)) fail(404, 'Ação desconhecida.');
      if (req.method !== METHODS[action]) fail(405, 'Método não permitido.');
      let body = {};
      if (req.method === 'POST') {
        // Proteção CSRF: só aceita JSON e pedidos da mesma origem.
        if (!String(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Pedido inválido.');
        const origin = req.headers['origin'];
        const host = req.headers['x-forwarded-host'] || req.headers['host'];
        if (origin && host && new URL(origin).host !== host) fail(403, 'Origem não permitida.');
        body = await readBody(req);
      }
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'desconhecido';
      await ensureSchema();
      const result = await actions[action]({ req, body, query, ip });
      send(result.status || 200, result.body, result);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error('[comunidade]', e);
      send(500, { error: 'O serviço está indisponível. Tente novamente dentro de momentos.' });
    }
  };
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body)) || {}; } catch { fail(400, 'Pedido inválido.'); }
  }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) fail(413, 'Pedido demasiado grande.'); }
  try { const v = raw ? JSON.parse(raw) : {}; return v && typeof v === 'object' ? v : {}; } catch { fail(400, 'Pedido inválido.'); }
}
