import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDevServer } from '../dev-server.js';

let srv, base;
before(async () => { srv = await startDevServer(0); base = `${srv.url}/api/comunidade`; });
after(() => srv.server.close());

async function call(action, { method = 'GET', data, query = {}, token, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (method === 'POST' && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  const r = await fetch(`${base}?${new URLSearchParams({ action, ...query })}`, { method, headers: h, body: data ? JSON.stringify(data) : undefined });
  return { status: r.status, body: await r.json(), setCookie: r.headers.get('set-cookie') };
}
const acc = (o = {}) => ({ kind: 'person', name: 'Ana Silva', email: 'ana@exemplo.pt', password: 'palavra-passe-segura', agree: true, ...o });
const ad = (o = {}) => ({ kind: 'offer', title: 'Aulas de português', category: 'Educação', city: 'Porto', description: 'Aulas para crianças e adultos, online ou presencial.', whatsapp: '+351 912 345 678', publicContact: true, ...o });

let tokenAna, tokenEmp, cookieAna;

test('diretório vazio funciona', async () => {
  const r = await call('directory');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  assert.equal(r.body.stats.offers, 0);
});

test('registo valida dados', async () => {
  assert.equal((await call('register', { method: 'POST', data: acc({ password: 'curta' }) })).status, 400);
  assert.equal((await call('register', { method: 'POST', data: acc({ email: 'invalido' }) })).status, 400);
  assert.equal((await call('register', { method: 'POST', data: acc({ agree: false }) })).status, 400);
});

test('registo cria conta e sessão', async () => {
  const r = await call('register', { method: 'POST', data: acc({ email: 'ANA@exemplo.pt' }) });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.user, { name: 'Ana Silva', kind: 'person', plan: 'free' });
  assert.ok(r.body.token);
  assert.match(r.setCookie, /ez_session=.+HttpOnly/);
  tokenAna = r.body.token;
  cookieAna = r.setCookie.split(';')[0];
  const dup = await call('register', { method: 'POST', data: acc() });
  assert.equal(dup.status, 409);
});

test('me funciona com token e com cookie', async () => {
  assert.equal((await call('me', { token: tokenAna })).body.user.name, 'Ana Silva');
  assert.equal((await call('me', { cookie: cookieAna })).body.user.name, 'Ana Silva');
  assert.equal((await call('me')).status, 401);
});

test('login certo e errado', async () => {
  assert.equal((await call('login', { method: 'POST', data: { email: 'ana@exemplo.pt', password: 'errada-errada' } })).status, 401);
  const ok = await call('login', { method: 'POST', data: { email: 'ana@exemplo.pt', password: 'palavra-passe-segura' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
});

test('publicar exige sessão e valida', async () => {
  assert.equal((await call('publish', { method: 'POST', data: ad() })).status, 401);
  assert.equal((await call('publish', { method: 'POST', data: ad({ category: 'Outra' }), token: tokenAna })).status, 400);
  assert.equal((await call('publish', { method: 'POST', data: ad({ publicContact: false }), token: tokenAna })).status, 400);
  const r = await call('publish', { method: 'POST', data: ad(), token: tokenAna });
  assert.equal(r.status, 201);
});

test('empresa publica e diretório mostra estatísticas', async () => {
  const r = await call('register', { method: 'POST', data: acc({ kind: 'company', name: 'Contas Lda', email: 'contas@exemplo.pt' }) });
  tokenEmp = r.body.token;
  await call('publish', { method: 'POST', token: tokenEmp, data: ad({ title: 'Contabilidade para independentes', category: 'Contabilistas', city: 'Lisboa', whatsapp: '00351 936 000 000' }) });
  await call('publish', { method: 'POST', token: tokenEmp, data: ad({ kind: 'request', title: 'Procuro estagiário', category: 'Serviços', city: 'lisboa' }) });
  const d = await call('directory');
  assert.equal(d.body.items.length, 2);
  assert.deepEqual(d.body.stats, { offers: 2, requests: 1, companies: 1, cities: 2 });
  assert.deepEqual(d.body.counts, { 'Educação': 1, Contabilistas: 1 });
  assert.equal(d.body.items.find((i) => i.account_kind === 'company').whatsapp, '351936000000');
  assert.equal((await call('directory', { query: { kind: 'request' } })).body.items.length, 1);
  assert.equal((await call('directory', { query: { q: 'contab' } })).body.items.length, 1);
  assert.equal((await call('directory', { query: { city: 'PORTO' } })).body.items.length, 1);
  assert.equal((await call('directory', { query: { q: '%' } })).body.items.length, 0);
  assert.equal((await call('directory', { query: { category: 'Educação' } })).body.items[0].account_name, 'Ana Silva');
});

test('paginação', async () => {
  for (let a = 0; a < 3; a++) {
    const t = (await call('register', { method: 'POST', data: acc({ email: `pessoa${a}@exemplo.pt` }) })).body.token;
    for (let i = 0; i < 4; i++) assert.equal((await call('publish', { method: 'POST', token: t, data: ad({ title: `Serviço ${a}-${i}`, category: 'Tecnologia' }) })).status, 201);
  }
  const p0 = await call('directory');
  assert.equal(p0.body.items.length, 12);
  assert.equal(p0.body.hasMore, true);
  const p1 = await call('directory', { query: { page: 1 } });
  assert.equal(p1.body.items.length, 2);
  assert.equal(p1.body.hasMore, false);
});

test('os meus anúncios e encerrar', async () => {
  const mine = await call('mine', { token: tokenAna });
  assert.equal(mine.body.items.length, 1);
  const id = mine.body.items[0].id;
  assert.equal((await call('close', { method: 'POST', token: tokenEmp, data: { id } })).status, 404, 'não pode encerrar anúncio de outra pessoa');
  assert.equal((await call('close', { method: 'POST', token: tokenAna, data: { id } })).status, 200);
  assert.equal((await call('mine', { token: tokenAna })).body.items[0].status, 'closed');
  assert.equal((await call('directory', { query: { category: 'Educação' } })).body.items.length, 0);
});

test('proteções: método, CSRF, ação desconhecida', async () => {
  assert.equal((await call('publish', { token: tokenAna })).status, 405);
  assert.equal((await call('nada')).status, 404);
  assert.equal((await call('logout', { method: 'POST', data: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('login', { method: 'POST', data: {}, headers: { Origin: 'https://site-malicioso.com' } })).status, 403);
});

test('limite diário de publicações', async () => {
  const t = (await call('register', { method: 'POST', data: acc({ email: 'muitos@exemplo.pt' }) })).body.token;
  for (let i = 0; i < 10; i++) assert.equal((await call('publish', { method: 'POST', token: t, data: ad({ title: `Anúncio ${i}` }) })).status, 201);
  assert.equal((await call('publish', { method: 'POST', token: t, data: ad() })).status, 429);
});

test('bloqueia força bruta no login', async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await call('login', { method: 'POST', data: { email: 'contas@exemplo.pt', password: 'tentativa-' + i } });
  assert.equal(last.status, 429);
});

test('logout termina a sessão', async () => {
  assert.equal((await call('logout', { method: 'POST', data: {}, token: tokenAna })).status, 200);
  assert.equal((await call('me', { token: tokenAna })).status, 401);
});

test('palavra-passe nunca é guardada em texto', async () => {
  const { rows } = await srv.pgl.query(`select password_hash from ez_accounts`);
  for (const r of rows) assert.match(r.password_hash, /^scrypt\$/);
  const { rows: s } = await srv.pgl.query(`select token_hash from ez_sessions`);
  for (const r of s) assert.notEqual(r.token_hash, tokenEmp);
});
