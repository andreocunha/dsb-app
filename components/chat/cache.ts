'use client';
import { forgetSignedUrls } from './files';
import type { Message } from './types';

// As últimas conversas abertas ficam guardadas no aparelho: reabrir mostra as mensagens na hora,
// enquanto as novas chegam do banco por baixo. Sai tudo quando a pessoa sai da conta.
const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES = 100;
const STORAGE = 'dsb-chat-cache';
const SAVE_DELAY = 1000;

export type CachedConversation = { messages: Message[]; hasMore: boolean };
type Saved = { owner: string; entries: [string, CachedConversation][] };

let owner: string | null = null;
let store = new Map<string, CachedConversation>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Uma pessoa por vez no aparelho: trocou de conta, o que era da outra não aparece. */
function load(user: string | null) {
  const id = user ?? '';
  if (owner === id) return store;
  owner = id;
  store = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Saved | null;
    if (saved?.owner === id && Array.isArray(saved.entries)) store = new Map(saved.entries);
  } catch { /* Sem acesso ao armazenamento: o cache fica só na memória. */ }
  return store;
}

function save() {
  if (owner === null) return;
  try { localStorage.setItem(STORAGE, JSON.stringify({ owner, entries: [...store] } satisfies Saved)); }
  catch { /* Cheio ou bloqueado: continua valendo na memória até fechar o app. */ }
}

export function cachedConversation(user: string | null, key: string): CachedConversation | null {
  return load(user).get(key) ?? null;
}

/** Guarda as últimas mensagens já confirmadas; a conversa vai para o topo da fila e a mais antiga da fila sai. */
export function cacheConversation(user: string | null, key: string, messages: Message[], hasMore: boolean) {
  const conversations = load(user);
  const sent = messages.filter(m => !m.pending);
  // A prévia local (blob:) não sobrevive a fechar o app: o balão volta a usar a miniatura do servidor.
  const kept = sent.slice(-MAX_MESSAGES).map(m => m.localUrl ? { ...m, localUrl: undefined } : m);
  conversations.delete(key);
  conversations.set(key, { messages: kept, hasMore: hasMore || kept.length < sent.length });
  while (conversations.size > MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value!);
  clearTimeout(timer);
  timer = setTimeout(save, SAVE_DELAY);
}

export function forgetConversation(user: string | null, key: string) {
  if (!load(user).delete(key)) return;
  clearTimeout(timer);
  timer = setTimeout(save, SAVE_DELAY);
}

export function clearChatCache() {
  clearTimeout(timer);
  forgetSignedUrls();
  owner = null;
  store = new Map();
  try { localStorage.removeItem(STORAGE); } catch { /* nada guardado */ }
}
