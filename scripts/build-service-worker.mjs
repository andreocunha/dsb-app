import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
async function walk(dir) {
  const entries = await readdir(dir,{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):path.join(dir,entry.name)))).flat();
}
const files = (await walk('out')).filter(file=>!file.endsWith('/sw.js') && !file.endsWith('.map'));
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const version = hash.digest('hex').slice(0,12);
const assets = files.map(file=>'/' + path.relative('out',file).split(path.sep).join('/'));
assets.push('/', '/comunidade/', '/fantasy/', '/configuracoes/');
await writeFile('out/sw.js', `// Generated on build. Caches only this application's static assets.
const CACHE = 'dsb-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dsb-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch { if (event.request.mode === 'navigate') return (await cache.match('/404.html')) || Response.error(); return Response.error(); }
  })());
});
`);
console.log(`PWA: ${assets.length} assets cached, version ${version}.`);
