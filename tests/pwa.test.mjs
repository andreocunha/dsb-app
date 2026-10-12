import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// O worker é um arquivo estático em public/ (não é mais gerado no build): o teste lê direto dele.
const worker = await readFile('public/sw.js', 'utf8');
const TELAS = ['/', '/comunidade/', '/fantasy/', '/configuracoes/'];

/** missing: rotas que o servidor não entrega (a instalação precisa seguir sem elas). */
function environment(missing = []) {
  const handlers = {}; const entries = new Map();
  const path = request => new URL(typeof request === 'string' ? request : request.url, 'https://dsb.test').pathname;
  const cache = {
    add: async route => { if (missing.includes(route)) throw new Error('404'); entries.set(route, new Response(route)); },
    put: async (request, response) => { entries.set(path(request), response); },
    // Como o cache de verdade: cada leitura devolve uma resposta nova.
    match: async request => entries.get(path(request))?.clone(),
  };
  vm.runInNewContext(worker, { URL, Response, Promise, self: { location: { origin: 'https://dsb.test' }, skipWaiting: async () => {}, clients: { claim: async () => {} }, addEventListener: (name, fn) => { handlers[name] = fn; } }, caches: { open: async () => cache, keys: async () => [], delete: async () => true }, fetch: async () => { throw new Error('offline'); } });
  const install = async () => { let done; handlers.install({ waitUntil: p => { done = p; } }); await done; };
  const navigate = async route => { let response; handlers.fetch({ request: { method: 'GET', url: `https://dsb.test${route}`, mode: 'navigate' }, respondWith: p => { response = p; } }); return (await response).text(); };
  return { handlers, install, navigate, cached: () => [...entries.keys()] };
}

test('pré-cache inclui as telas do app e a página de sem conexão', async () => {
  const env = environment();
  await env.install();
  for (const route of [...TELAS, '/offline.html']) assert.ok(env.cached().includes(route), route);
});

test('uma rota que falha não derruba a instalação', async () => {
  const env = environment(['/offline/', '/fantasy/']);
  await env.install();
  assert.deepEqual(env.cached(), ['/', '/comunidade/', '/configuracoes/', '/offline.html']);
});

test('telas conhecidas continuam disponíveis sem rede', async () => {
  const env = environment(['/offline/']);
  await env.install();
  for (const route of TELAS) assert.equal(await env.navigate(route), route);
  // A conversa aberta vai no endereço (?c=): a tela é a mesma.
  assert.equal(await env.navigate('/comunidade/?c=geral'), '/comunidade/');
});

test('tela que não está guardada cai na página de sem conexão', async () => {
  const env = environment(['/offline/']);
  await env.install();
  assert.equal(await env.navigate('/sobre/'), '/offline.html');
});

test('mapa externo e YouTube não são interceptados pelo cache', () => {
  const env = environment();
  for (const url of ['https://dsb-rastreio.vercel.app/', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE']) env.handlers.fetch({ request: { method: 'GET', url }, respondWith: () => assert.fail('Origem externa interceptada') });
});
