// Modo offline do site (o app das lojas não registra service worker: ver app-shell.tsx).
//
// Este arquivo mora em public/ de propósito. A versão anterior era gerada em out/ no fim do
// build, com a lista exata dos arquivos a pré-cachear, e essa escrita tardia não chegava ao
// deploy: /sw.js respondia 404 em produção e o modo offline nunca existiu. Sem lista gerada,
// não há mais nada para se perder entre o build e a publicação.
const CACHE = 'dsb-v1';

// Caminhos estáveis, sem hash no nome. Uma falha aqui não pode derrubar a instalação.
const ROTAS = ['/', '/comunidade/', '/fantasy/', '/configuracoes/', '/offline/', '/offline.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ROTAS.map(rota => cache.add(rota)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter(chave => chave.startsWith('dsb-') && chave !== CACHE).map(chave => caches.delete(chave)));
    await self.clients.claim();
  })());
});

// Arquivos com hash no nome, ou que só mudam em deploy: servir do cache é sempre seguro.
const imutavel = url => /^\/(_next\/static|icons|logos|images)\//.test(url.pathname);

const paginaOffline = async cache =>
  (await cache.match('/offline/')) || (await cache.match('/offline.html')) || Response.error();

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // O Supabase e o mapa são de outra origem: passam direto, sem cache.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (imutavel(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const guardado = await cache.match(event.request);
      if (guardado) return guardado;
      const resposta = await fetch(event.request);
      if (resposta.ok) void cache.put(event.request, resposta.clone());
      return resposta;
    })());
    return;
  }

  // Páginas vão à rede primeiro, senão o placar e o chat voltariam velhos.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const resposta = await fetch(event.request);
      if (resposta.ok && event.request.mode === 'navigate') void cache.put(event.request, resposta.clone());
      return resposta;
    } catch {
      const guardado = await cache.match(event.request, { ignoreSearch: true });
      if (guardado) return guardado;
      return event.request.mode === 'navigate' ? paginaOffline(cache) : Response.error();
    }
  })());
});
