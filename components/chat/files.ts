'use client';
import { useEffect, useState } from 'react';
import { chatFileUrl, supabase } from '@/lib/supabase';

// Arquivos do grupo ficam no bucket público "chat"; os das conversas particulares, no privado "dm",
// lidos por link temporário. O cache evita pedir o mesmo link a cada render.
export const bucketFor = (conversationId: string | null) => conversationId ? 'dm' : 'chat';

const TTL = 60 * 60; // segundos
const STORAGE = 'dsb-signed-urls';
const signed = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string | null>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Os links ainda válidos ficam guardados no aparelho: reabrir o app usa o mesmo endereço,
// e a miniatura vem do cache do navegador em vez de baixar de novo.
if (typeof window !== 'undefined') {
  try {
    for (const [key, hit] of JSON.parse(localStorage.getItem(STORAGE) ?? '[]') as [string, { url: string; expires: number }][])
      if (hit.expires > Date.now()) signed.set(key, hit);
  } catch { /* Sem armazenamento: os links vivem só na memória. */ }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify([...signed].filter(([, hit]) => hit.expires > Date.now()))); }
    catch { /* cheio ou bloqueado */ }
  }, 1000);
}

/** Saiu da conta: os links das conversas particulares não ficam no aparelho. */
export function forgetSignedUrls() {
  clearTimeout(saveTimer);
  signed.clear();
  try { localStorage.removeItem(STORAGE); } catch { /* nada guardado */ }
}

function sign(path: string, download?: string) {
  const key = `${path}|${download ?? ''}`;
  const hit = signed.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.url);
  // Vencido: sai do cache, para o render não usar mais este link enquanto o novo não chega.
  signed.delete(key);
  if (!pending.has(key)) pending.set(key, supabase.storage.from('dm').createSignedUrl(path, TTL, download ? { download } : undefined).then(({ data }) => {
    pending.delete(key);
    if (!data) return null;
    signed.set(key, { url: data.signedUrl, expires: Date.now() + (TTL - 120) * 1000 });
    persist();
    return data.signedUrl;
  }));
  return pending.get(key)!;
}

/** Link do arquivo de uma mensagem: na hora para o grupo, depois de assinado para as particulares. */
export function useFileUrl(conversationId: string | null, path: string | null, download?: string) {
  const key = path ? `${path}|${download ?? ''}` : '';
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!conversationId || !path) return;
    let alive = true;
    void sign(path, download).then(url => { if (alive && url) setLoaded({ key: `${path}|${download ?? ''}`, url }); });
    return () => { alive = false; };
  }, [conversationId, path, download]);
  if (!path) return null;
  if (!conversationId) return download ? `${chatFileUrl(path)}?download=${encodeURIComponent(download)}` : chatFileUrl(path);
  return signed.get(key)?.url ?? (loaded?.key === key ? loaded.url : null);
}
