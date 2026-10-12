'use client';
import { supabase } from '@/lib/supabase';
import { forgetSignedUrls } from './files';
import { GROUP_KEY, toReply, type Chat, type Last, type Message, type Row } from './types';

// Fica guardado no aparelho: a lista de conversas e, das 20 mais recentes (mais o grupo geral), as últimas 50 mensagens.
// Abrir o chat ou uma conversa mostra isso na hora, enquanto o banco atualiza por baixo. Sai tudo quando a pessoa sai da conta.
export const MAX_CONVERSATIONS = 20;
/** Uma página de mensagens: o que fica guardado de cada conversa e o que carrega por vez ao subir. */
export const PAGE = 50;
const STORAGE = 'dsb-chat-cache';
const LIST_STORAGE = 'dsb-chat-list';
const SAVE_DELAY = 1000;
// Quantas conversas são buscadas ao mesmo tempo para deixar as mensagens prontas.
const PARALLEL = 3;

export type CachedConversation = { messages: Message[]; hasMore: boolean };
export type CachedList = { chats: Chat[]; groupLast: Last | null; blocked: string[] };
type Saved = { owner: string; entries: [string, CachedConversation][] };
type SavedList = { owner: string } & CachedList;

let owner: string | null = null;
let store = new Map<string, CachedConversation>();
let list: CachedList | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const dirty = { messages: false, list: false };
const warming = new Set<string>();

/** Uma pessoa por vez no aparelho: trocou de conta, o que era da outra não aparece. */
function load(user: string | null) {
  const id = user ?? '';
  if (owner === id) return store;
  owner = id;
  store = new Map();
  list = null;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Saved | null;
    if (saved?.owner === id && Array.isArray(saved.entries)) store = new Map(saved.entries.map(([key, cached]) =>
      [key, { messages: cached.messages.slice(-PAGE), hasMore: cached.hasMore || cached.messages.length > PAGE }]));
    const savedList = JSON.parse(localStorage.getItem(LIST_STORAGE) ?? 'null') as SavedList | null;
    if (savedList?.owner === id && Array.isArray(savedList.chats)) list = { chats: savedList.chats, groupLast: savedList.groupLast ?? null, blocked: savedList.blocked ?? [] };
  } catch { /* Sem acesso ao armazenamento: o cache fica só na memória. */ }
  return store;
}

function save() {
  clearTimeout(timer);
  timer = undefined;
  if (owner === null) return;
  try {
    if (dirty.messages) localStorage.setItem(STORAGE, JSON.stringify({ owner, entries: [...store] } satisfies Saved));
    if (dirty.list && list) localStorage.setItem(LIST_STORAGE, JSON.stringify({ owner, ...list } satisfies SavedList));
  } catch { /* Cheio ou bloqueado: continua valendo na memória até fechar o app. */ }
  dirty.messages = dirty.list = false;
}

/** Grava daqui a pouco, juntando o que mudar até lá (com mensagens chegando sem parar, grava uma vez por segundo). */
function saveSoon(what: keyof typeof dirty) {
  dirty[what] = true;
  timer ??= setTimeout(save, SAVE_DELAY);
}

// Saiu do app antes de gravar: grava agora, para a próxima abertura já vir com o que estava na tela.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) save(); });

/** A conversa vai para o topo da fila. O grupo geral nunca sai; das outras, sai primeiro a que está há mais tempo sem mexer. */
function put(key: string, messages: Message[], hasMore: boolean) {
  const sent = messages.filter(m => !m.pending);
  // A prévia local (blob:) não sobrevive a fechar o app: o balão volta a usar a miniatura do servidor.
  const kept = sent.slice(-PAGE).map(m => m.localUrl ? { ...m, localUrl: undefined } : m);
  store.delete(key);
  store.set(key, { messages: kept, hasMore: hasMore || kept.length < sent.length });
  for (const old of store.keys()) {
    if (store.size <= MAX_CONVERSATIONS + 1) break;
    if (old !== GROUP_KEY) store.delete(old);
  }
  saveSoon('messages');
}

/** Uma página da conversa, da mensagem mais antiga para a mais nova (null: o banco não respondeu). */
export async function fetchPage(conversationId: string | null, before?: number) {
  const { data, error } = await supabase.rpc('chat_messages', { p_before: before, p_limit: PAGE, p_conversation_id: conversationId ?? undefined });
  return error ? null : (data as unknown as Message[]).reverse();
}

export function cachedConversation(user: string | null, key: string): CachedConversation | null {
  return load(user).get(key) ?? null;
}

/** Guarda as últimas mensagens já confirmadas da conversa aberta. */
export function cacheConversation(user: string | null, key: string, messages: Message[], hasMore: boolean) {
  load(user);
  put(key, messages, hasMore);
}

/** Mensagem nova numa conversa fechada: entra no que está guardado, para a conversa abrir já com ela. */
export function cacheNewMessage(user: string | null, key: string, row: Row) {
  const cached = load(user).get(key);
  if (!cached || row.id <= (cached.messages.at(-1)?.id ?? 0)) return;
  const original = cached.messages.find(m => m.id === row.reply_to);
  put(key, [...cached.messages, { ...row, reactions: [], reply: original ? toReply(original) : null }], cached.hasMore);
}

/** Mensagem editada ou apagada numa conversa fechada. */
export function cacheChangedMessage(user: string | null, key: string, row: Row) {
  const cached = load(user).get(key);
  if (!cached?.messages.some(m => m.id === row.id)) return;
  store.set(key, { ...cached, messages: cached.messages.map(m => m.id === row.id ? { ...m, ...row } : m) });
  saveSoon('messages');
}

/**
 * Deixa guardadas as mensagens das conversas mais recentes, para abrirem na hora mesmo sem nunca terem sido abertas neste aparelho.
 * Só vai ao banco pelas que faltam ou ficaram para trás (a última guardada não é a última da lista), poucas por vez.
 * open: a conversa aberta cuida do próprio cache.
 */
export function warmConversations(user: string | null, recent: { key: string; lastId: number }[], open: string | null) {
  const conversations = load(user);
  const queue: string[] = [];
  // Da mais antiga para a mais nova: as mais recentes ficam por último na fila de saída.
  for (const { key, lastId } of [...recent].sort((a, b) => a.lastId - b.lastId).slice(-MAX_CONVERSATIONS)) {
    if (key === open || warming.has(key)) continue;
    const cached = conversations.get(key);
    if (cached && cached.messages.at(-1)?.id === lastId) { conversations.delete(key); conversations.set(key, cached); }
    else { warming.add(key); queue.push(key); }
  }
  const next = async (): Promise<void> => {
    // A mais recente primeiro: é a que a pessoa mais provavelmente vai abrir.
    const key = queue.pop();
    if (!key) return;
    const page = await fetchPage(key === GROUP_KEY ? null : key);
    warming.delete(key);
    // Trocou de conta no meio do caminho: o que chegou era da outra pessoa.
    if (page && owner === (user ?? '')) put(key, page, page.length === PAGE);
    return next();
  };
  for (let i = 0; i < PARALLEL; i++) void next();
}

export function forgetConversation(user: string | null, key: string) {
  if (load(user).delete(key)) saveSoon('messages');
}

export function cachedChatList(user: string | null): CachedList | null {
  load(user);
  return list;
}

/** Guarda a lista como está na tela (só as conversas mais recentes), para a próxima abertura. */
export function cacheChatList(user: string | null, next: CachedList) {
  load(user);
  list = { ...next, chats: [...next.chats].sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0)).slice(0, MAX_CONVERSATIONS) };
  saveSoon('list');
}

export function clearChatCache() {
  clearTimeout(timer);
  timer = undefined;
  dirty.messages = dirty.list = false;
  forgetSignedUrls();
  owner = null;
  store = new Map();
  list = null;
  try { localStorage.removeItem(STORAGE); localStorage.removeItem(LIST_STORAGE); } catch { /* nada guardado */ }
}
