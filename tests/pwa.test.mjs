import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const worker = await readFile('out/sw.js','utf8');
function environment() {
  const handlers = {}; const entries = new Map(); let installed = [];
  const cache = { addAll: async paths => { installed = [...paths]; for (const p of paths) entries.set(p, new Response(p)); }, match: async request => entries.get(new URL(typeof request === 'string' ? request : request.url, 'https://dsb.test').pathname) };
  vm.runInNewContext(worker, { URL, Response, self: { location: {origin:'https://dsb.test'}, clients:{claim:async()=>{}}, addEventListener:(name, fn)=>{handlers[name]=fn;} }, caches:{open:async()=>cache, keys:async()=>[],delete:async()=>true}, fetch:async()=>{throw new Error('offline');} });
  return { handlers, getAssets:()=>installed };
}
test('pré-cache inclui todas as telas e arquivos que realmente existem', async () => {
  const env = environment(); let install; env.handlers.install({waitUntil:p=>{install=p;}}); await install;
  for (const route of ['/','/comunidade/','/fantasy/','/configuracoes/','/manifest.webmanifest','/icons/icon-192.png','/images/event-race.jpg']) assert.ok(env.getAssets().includes(route), route);
  for (const asset of env.getAssets()) await readFile(`out${asset.endsWith('/') ? asset+'index.html' : asset}`);
});
test('telas conhecidas continuam disponíveis sem rede', async () => {
  const env = environment(); let install; env.handlers.install({waitUntil:p=>{install=p;}}); await install;
  for (const route of ['/','/comunidade/','/fantasy/','/configuracoes/']) {
    let response; env.handlers.fetch({request:{method:'GET',url:`https://dsb.test${route}`,mode:'navigate'}, respondWith:p=>{response=p;}});
    assert.equal(await (await response).text(), route);
  }
});
test('mapa externo e YouTube não são interceptados pelo cache', () => {
  const env = environment();
  for (const url of ['https://dsb-rastreio.vercel.app/','https://www.youtube-nocookie.com/embed/M7lc1UVf-VE']) env.handlers.fetch({request:{method:'GET',url},respondWith:()=>assert.fail('Origem externa interceptada')});
});
