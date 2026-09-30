'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, ChevronDown, Copy, EllipsisVertical, Flag, LogIn, Pencil, Pin, Reply as ReplyIcon, Trash2, UserX } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { dayLabel } from '@/lib/chat-format';
import { makeThumbnail, MAX_FILE_SIZE, storageName } from '@/lib/media';
import { shortName } from '@/lib/names';
import { supabase, errorMessage } from '@/lib/supabase';
import { lastReadId, useApp, useChatUnread, useOnline } from '../app-shell';
import { useAuth } from '../auth';
import { Sheet } from '../ui';
import { Compose, type ComposeContext } from './compose';
import { EmojiPicker } from './emoji-picker';
import { GroupInfo } from './group-info';
import { MediaSend, type Pick } from './media-send';
import { Bubble, MessageRow, type MenuRequest } from './message';
import { MessageMenu, type MenuAction } from './message-menu';
import { Reactors } from './reactors';
import { canEdit, isImage, toReply, type Message, type Reaction, type Reply, type Row } from './types';
import { Viewer } from './viewer';

const PAGE = 50;
const TYPING_EVERY = 3000;
const TYPING_TTL = 5000;
const MAX_JUMP_PAGES = 10;
type Confirm = { title: string; text: string; label: string; run: () => void };

async function fetchPage(before?: number) {
  const { data, error } = await supabase.rpc('chat_messages', { p_before: before, p_limit: PAGE });
  return error ? null : (data as unknown as Message[]).reverse();
}

// Mensagens ainda enviando ficam sempre no fim, na ordem em que saíram.
const order = (m: Message) => m.pending ? Number.MAX_SAFE_INTEGER : m.id;
const sorted = (list: Message[]) => [...list].sort((a, b) => order(a) - order(b));
const wiped = (m: Message, by: string | null): Message =>
  ({ ...m, deleted_at: new Date().toISOString(), deleted_by: by, body: null, file_path: null, thumb_path: null, file_name: null, file_type: null, reactions: [] });

export function Community() {
  const router = useRouter();
  const { userId, profile, requireLogin } = useAuth();
  // Moderação: a organização pode remover qualquer mensagem.
  const moderador = profile?.role === 'moderator';
  const { notify } = useApp();
  const { markRead } = useChatUnread();
  const online = useOnline();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [context, setContext] = useState<ComposeContext>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [reactPicker, setReactPicker] = useState<Message | null>(null);
  const [reactorsOf, setReactorsOf] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<Message | null>(null);
  const [info, setInfo] = useState<null | 'info' | 'blocked'>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [typers, setTypers] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<number | null>(null);
  // Faixa "N mensagens não lidas": o que chegou entre a última visita e a abertura do chat.
  const [readAtOpen] = useState(lastReadId);
  const [unreadUpTo, setUnreadUpTo] = useState(0);
  // Quando a pessoa está lendo mensagens antigas, as novas viram um contador no botão de descer.
  const [newCount, setNewCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const prependFrom = useRef<number | null>(null);
  const initialScroll = useRef(false);
  const jumpTarget = useRef<number | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);
  const lastTyping = useRef(0);
  const draft = useRef('');
  const known = useRef(new Set<number>());

  const applyPage = useCallback((page: Message[] | null, before?: number) => {
    if (!page) { if (before) notify('Não foi possível carregar as mensagens anteriores.'); else setStatus('error'); return; }
    if (before) prependFrom.current = list.current?.scrollHeight ?? null;
    setMessages(current => before ? [...page.filter(m => !current.some(c => c.id === m.id)), ...current] : page);
    setHasMore(page.length === PAGE);
    setStatus('ready');
    if (!before && page.length) {
      setUnreadUpTo(page[page.length - 1].id);
      markRead(page[page.length - 1].id);
    }
  }, [markRead, notify]);

  useEffect(() => { known.current = new Set(messages.map(m => m.id)); }, [messages]);

  // Carga inicial + tempo real (mensagens, reações e quem está digitando).
  useEffect(() => {
    void fetchPage().then(page => applyPage(page));
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const stopTyping = (id: string) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      setTypers(current => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; });
    };
    const upsertReaction = (reaction: Reaction & { message_id: number }) => setMessages(current => current.map(m => m.id !== reaction.message_id ? m
      : { ...m, reactions: [...m.reactions.filter(r => r.user_id !== reaction.user_id), { user_id: reaction.user_id, emoji: reaction.emoji }] }));
    const realtime = supabase.channel('chat', { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: payload }) => {
        const row = payload as Row;
        stopTyping(row.user_id);
        setMessages(current => {
          // O envio em andamento deste aparelho troca a própria prévia pela mensagem salva.
          if (current.some(m => m.id === row.id || (m.pending && m.user_id === row.user_id))) return current;
          const original = current.find(m => m.id === row.reply_to);
          return sorted([...current, { ...row, reactions: [], reply: original ? toReply(original) : null }]);
        });
        // Citação de uma mensagem que não está carregada: busca só o resumo dela.
        if (row.reply_to && !known.current.has(row.reply_to)) void supabase.from('messages')
          .select('id, user_id, author_name, body, file_type, file_name, thumb_path, deleted_at').eq('id', row.reply_to).maybeSingle()
          .then(({ data }) => { if (data) setMessages(current => current.map(m => m.id === row.id ? { ...m, reply: { ...data, deleted: !!data.deleted_at } } : m)); });
        if (stickToBottom.current) markRead(row.id); else setNewCount(count => count + 1);
      })
      // Edições, e a pessoa que trocou o nome e teve as mensagens antigas atualizadas.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) =>
        setMessages(current => current.map(m => m.id === row.id ? { ...m, ...(row as Row) } : m)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) =>
        setMessages(current => current.filter(m => m.id !== old.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old }) =>
        setMessages(current => current.map(m => m.id !== old.message_id ? m : { ...m, reactions: m.reactions.filter(r => r.user_id !== old.user_id) })))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { id, name } = payload as { id: string; name: string };
        if (typeof id !== 'string' || typeof name !== 'string') return;
        setTypers(current => current[id] === name ? current : { ...current, [id]: name.slice(0, 40) });
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => stopTyping(id), TYPING_TTL));
      })
      .subscribe();
    channel.current = realtime;
    return () => { channel.current = null; timers.forEach(clearTimeout); void supabase.removeChannel(realtime); };
  }, [applyPage, markRead]);

  useEffect(() => {
    if (!userId) return;
    void supabase.from('user_blocks').select('blocked_id').then(({ data }) => setBlocked((data ?? []).map(b => b.blocked_id)));
  }, [userId]);

  // Abre na faixa de não lidas (ou no fim), mantém a conversa no fim quando chegam mensagens
  // e a posição ao carregar as antigas.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (prependFrom.current !== null) { el.scrollTop += el.scrollHeight - prependFrom.current; prependFrom.current = null; }
    else if (!initialScroll.current && messages.length) {
      initialScroll.current = true;
      const divider = el.querySelector<HTMLElement>('.unread-divider');
      el.scrollTop = divider ? divider.offsetTop - 64 : el.scrollHeight;
    } else if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    if (jumpTarget.current !== null) {
      document.getElementById(`m-${jumpTarget.current}`)?.scrollIntoView({ block: 'center' });
      jumpTarget.current = null;
    }
  }, [messages, flash]);

  // A barra de digitar muda de altura (resposta, várias linhas, emojis): quem está no fim continua no fim.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(() => { if (stickToBottom.current) el.scrollTop = el.scrollHeight; });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function onScroll() {
    const el = list.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottom.current = bottom;
    // Como no WhatsApp, as anteriores carregam sozinhas ao chegar perto do topo.
    if (el.scrollTop < 300 && hasMore && !loadingOlder) void loadOlder();
    if (bottom === atBottom) return;
    setAtBottom(bottom);
    if (bottom) goToBottom();
  }

  function goToBottom() {
    setNewCount(0);
    const lastId = messages.findLast(m => !m.pending)?.id;
    if (lastId) markRead(lastId);
  }

  function scrollToBottom() {
    stickToBottom.current = true;
    // Salto direto: rolagem suave fica pendurada quando a aba está em segundo plano.
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    setAtBottom(true);
    goToBottom();
  }

  async function loadOlder() {
    const oldest = messages.find(m => !m.pending)?.id;
    if (!oldest) return;
    setLoadingOlder(true);
    applyPage(await fetchPage(oldest), oldest);
    setLoadingOlder(false);
  }

  /** Toque na citação: rola até a original (carregando as anteriores se precisar) e ela pisca. */
  async function jumpTo(id: number) {
    let found = messages.some(m => m.id === id);
    let oldest = messages.find(m => !m.pending)?.id;
    let more = hasMore;
    for (let i = 0; !found && more && oldest && i < MAX_JUMP_PAGES; i++) {
      const page = await fetchPage(oldest);
      if (!page) break;
      applyPage(page, oldest);
      found = page.some(m => m.id === id);
      oldest = page[0]?.id;
      more = page.length === PAGE;
    }
    if (!found) { notify('Não foi possível encontrar a mensagem original.'); return; }
    jumpTarget.current = id;
    setFlash(id);
    setTimeout(() => setFlash(current => current === id ? null : current), 1600);
  }

  function sendTyping() {
    if (!userId || !profile || Date.now() - lastTyping.current < TYPING_EVERY) return;
    lastTyping.current = Date.now();
    void channel.current?.send({ type: 'broadcast', event: 'typing', payload: { id: userId, name: shortName(profile.name) } });
  }

  /** Aparece na hora com o relógio; o ✓ entra quando o banco confirma. */
  async function send({ body, file, localUrl, replyTo }: { body: string; file?: File; localUrl?: string; replyTo: Message | null }) {
    if (!userId || !profile) { requireLogin('Entre para conversar com a torcida.'); return; }
    const tempId = -Date.now();
    const reply = replyTo ? toReply(replyTo) : null;
    stickToBottom.current = true;
    lastTyping.current = 0;
    setNewCount(0);
    setUnreadUpTo(0);
    setMessages(current => [...current, {
      id: tempId, user_id: userId, author_name: profile.name, author_avatar: profile.avatar_url, body: body || null,
      file_path: file ? 'pending' : null, file_name: file?.name ?? null, file_type: file ? file.type || 'application/octet-stream' : null,
      file_size: file?.size ?? null, thumb_path: null, width: null, height: null, created_at: new Date().toISOString(),
      deleted_at: null, deleted_by: null, reply_to: replyTo?.id ?? null, edited_at: null, reactions: [], reply, pending: true, localUrl,
    }]);
    const uploaded: string[] = [];
    try {
      const args: Database['public']['Functions']['send_message']['Args'] = { p_body: body || undefined, p_reply_to: replyTo?.id };
      if (file) {
        const folder = `${userId}/${crypto.randomUUID()}`;
        const path = `${folder}/${storageName(file.name)}`;
        const [thumb, upload] = await Promise.all([
          makeThumbnail(file),
          supabase.storage.from('chat').upload(path, file, { contentType: file.type || 'application/octet-stream', cacheControl: '31536000' }),
        ]);
        if (upload.error) throw upload.error;
        uploaded.push(path);
        Object.assign(args, { p_file_path: path, p_file_name: file.name });
        if (thumb) {
          const thumbPath = `${folder}/.thumb.jpg`;
          const { error } = await supabase.storage.from('chat').upload(thumbPath, thumb.blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
          if (!error) { uploaded.push(thumbPath); Object.assign(args, { p_thumb_path: thumbPath, p_width: thumb.width, p_height: thumb.height }); }
        }
      }
      const { data, error } = await supabase.rpc('send_message', args);
      if (error) throw error;
      setMessages(current => sorted(current.filter(m => m.id !== data.id).map(m => m.id === tempId ? { ...data, reactions: [], reply, localUrl } : m)));
      markRead(data.id);
    } catch (error) {
      if (uploaded.length) void supabase.storage.from('chat').remove(uploaded);
      setMessages(current => current.filter(m => m.id !== tempId));
      // Falhou: o texto volta para o campo, para não se perder.
      if (!file && body) setText(current => current || body);
      notify(errorMessage(error));
    }
  }

  function submit() {
    if (!userId) { requireLogin('Entre para conversar com a torcida.'); return; }
    if (context?.kind === 'edit') { void saveEdit(context.message); return; }
    const body = text.trim();
    if (!body) return;
    void send({ body, replyTo: context?.kind === 'reply' ? context.message : null });
    setText('');
    setContext(null);
    input.current?.focus();
  }

  async function saveEdit(message: Message) {
    const body = text.trim();
    if (!body) return;
    setContext(null);
    setText(draft.current);
    if (body === message.body) return;
    setMessages(current => current.map(m => m.id === message.id ? { ...m, body, edited_at: new Date().toISOString() } : m));
    const { data, error } = await supabase.rpc('edit_message', { p_id: message.id, p_body: body });
    if (error) {
      setMessages(current => current.map(m => m.id === message.id ? { ...m, body: message.body, edited_at: message.edited_at } : m));
      notify(errorMessage(error));
      return;
    }
    setMessages(current => current.map(m => m.id === data.id ? { ...m, ...data } : m));
  }

  function startReply(message: Message) {
    if (!userId) { requireLogin('Entre para responder mensagens.'); return; }
    if (context?.kind === 'edit') setText(draft.current);
    setContext({ kind: 'reply', message });
    input.current?.focus();
  }

  function startEdit(message: Message) {
    if (context?.kind !== 'edit') draft.current = text;
    setContext({ kind: 'edit', message });
    setText(message.body ?? '');
    input.current?.focus();
  }

  function cancelContext() {
    if (context?.kind === 'edit') setText(draft.current);
    setContext(null);
  }

  function chooseFile(file: File) {
    if (!userId) { requireLogin('Entre para mandar fotos e arquivos.'); return; }
    if (file.size > MAX_FILE_SIZE) { notify('Arquivos podem ter até 50MB.'); return; }
    setPick({ file, url: URL.createObjectURL(file) });
  }

  function closePick() {
    if (pick) URL.revokeObjectURL(pick.url);
    setPick(null);
  }

  function sendPick(caption: string) {
    if (!pick) return;
    const image = isImage({ file_type: pick.file.type });
    // A prévia local da foto continua no balão até a miniatura do servidor ser necessária.
    if (!image) URL.revokeObjectURL(pick.url);
    void send({ body: caption.trim(), file: pick.file, localUrl: image ? pick.url : undefined, replyTo: context?.kind === 'reply' ? context.message : null });
    if (context?.kind === 'reply') setContext(null);
    setPick(null);
  }

  async function react(message: Message, emoji: string) {
    setMenu(null);
    setReactPicker(null);
    if (!userId) { requireLogin('Entre para reagir às mensagens.'); return; }
    const mine = message.reactions.find(r => r.user_id === userId);
    const next = mine?.emoji === emoji ? null : emoji;
    setMessages(current => current.map(m => m.id !== message.id ? m : {
      ...m, reactions: [...m.reactions.filter(r => r.user_id !== userId), ...(next ? [{ user_id: userId, emoji: next }] : [])],
    }));
    const { error } = await supabase.rpc('react_to_message', { p_message_id: message.id, p_emoji: next });
    if (error) notify(errorMessage(error));
  }

  async function copy(message: Message) {
    try { await navigator.clipboard.writeText(message.body ?? ''); notify('Mensagem copiada.'); }
    catch { notify('Não foi possível copiar a mensagem.'); }
  }

  async function remove(message: Message) {
    if (context?.message.id === message.id) cancelContext();
    const { data, error } = await supabase.rpc('delete_message', { p_id: message.id });
    if (error) { notify(errorMessage(error)); return; }
    setMessages(current => current.map(m => m.id !== message.id ? m : wiped(m, userId)));
    if (data?.length) void supabase.storage.from('chat').remove(data);
  }

  async function report(message: Message) {
    const { error } = await supabase.rpc('report_message', { p_message_id: message.id });
    notify(error ? errorMessage(error) : 'Denúncia enviada. Obrigado por ajudar a manter o chat saudável.');
  }

  async function block(message: Message) {
    const { error } = await supabase.from('user_blocks').insert({ blocked_id: message.user_id });
    if (error && error.code !== '23505') { notify(errorMessage(error)); return; }
    // A App Store exige que bloquear também avise a organização sobre o conteúdo.
    void supabase.rpc('report_message', { p_message_id: message.id, p_reason: 'bloqueio' });
    setBlocked(current => [...current, message.user_id]);
    notify(`Você não verá mais mensagens de ${shortName(message.author_name)}. A organização foi avisada.`);
  }

  async function unblock(id: string) {
    const { error } = await supabase.from('user_blocks').delete().eq('blocked_id', id);
    if (error) { notify(errorMessage(error)); return; }
    setBlocked(current => current.filter(b => b !== id));
  }

  async function ban(message: Message) {
    const { error } = await supabase.rpc('ban_user', { p_user_id: message.user_id });
    if (error) { notify(errorMessage(error)); return; }
    setMessages(current => current.map(m => m.user_id !== message.user_id || m.deleted_at ? m : wiped(m, userId)));
    notify(`${shortName(message.author_name)} foi banido do chat e as mensagens saíram do ar.`);
  }

  /** Ações do menu como dados; quem executa é runAction, no toque. */
  function actionsFor(message: Message): MenuAction[] {
    const name = shortName(message.author_name);
    if (!userId) return [
      ...(message.body ? [{ id: 'copy', label: 'Copiar', icon: <Copy size={20} /> }] : []),
      { id: 'login', label: 'Entrar para responder', icon: <LogIn size={20} /> },
    ];
    const actions: MenuAction[] = [{ id: 'reply', label: 'Responder', icon: <ReplyIcon size={20} /> }];
    if (message.body) actions.push({ id: 'copy', label: 'Copiar', icon: <Copy size={20} /> });
    if (canEdit(message, userId)) actions.push({ id: 'edit', label: 'Editar', icon: <Pencil size={20} /> });
    if (message.user_id === userId) return [...actions, { id: 'delete', label: 'Apagar', icon: <Trash2 size={20} />, danger: true }];
    actions.push({ id: 'report', label: 'Denunciar', icon: <Flag size={20} />, danger: true });
    actions.push({ id: 'block', label: `Bloquear ${name}`, icon: <Ban size={20} />, danger: true });
    if (moderador) {
      actions.push({ id: 'remove', label: 'Remover (moderação)', icon: <Trash2 size={20} />, danger: true });
      actions.push({ id: 'ban', label: `Banir ${name}`, icon: <UserX size={20} />, danger: true });
    }
    return actions;
  }

  function runAction(message: Message, id: string) {
    setMenu(null);
    const name = shortName(message.author_name);
    switch (id) {
      case 'login': requireLogin('Entre para conversar com a torcida.'); break;
      case 'reply': startReply(message); break;
      case 'copy': void copy(message); break;
      case 'edit': startEdit(message); break;
      case 'delete': setConfirm({ title: 'Apagar mensagem?', text: 'A mensagem será apagada para todas as pessoas do grupo.', label: 'Apagar para todos', run: () => void remove(message) }); break;
      case 'report': setConfirm({ title: `Denunciar ${name}?`, text: 'A organização vai analisar esta mensagem em até 24 horas. Quem mandou não fica sabendo.', label: 'Denunciar', run: () => void report(message) }); break;
      case 'block': setConfirm({ title: `Bloquear ${name}?`, text: 'Você não verá mais as mensagens desta pessoa, e a organização será avisada. Dá para desbloquear nos dados do grupo.', label: 'Bloquear', run: () => void block(message) }); break;
      case 'remove': setConfirm({ title: `Remover a mensagem de ${name}?`, text: 'A mensagem sai do ar para todas as pessoas.', label: 'Remover', run: () => void remove(message) }); break;
      case 'ban': setConfirm({ title: `Banir ${name} do chat?`, text: 'A conta não poderá mais mandar mensagens, e todas as mensagens dela saem do ar.', label: 'Banir', run: () => void ban(message) }); break;
    }
  }

  function onDrop(e: React.DragEvent) {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    chooseFile(file);
  }

  const visible = messages.filter(m => !blocked.includes(m.user_id));
  const byId = new Map(messages.map(m => [m.id, m]));
  const replyOf = (m: Message): Reply | null => {
    if (!m.reply_to) return null;
    const original = byId.get(m.reply_to);
    return original ? toReply(original) : m.reply;
  };
  const firstUnread = readAtOpen && unreadUpTo ? visible.find(m => m.id > readAtOpen && m.id <= unreadUpTo && m.user_id !== userId)?.id : undefined;
  const unreadCount = firstUnread ? visible.filter(m => m.id >= firstUnread && m.id <= unreadUpTo && m.user_id !== userId).length : 0;
  const days: { key: string; label: string; items: Message[] }[] = [];
  for (const m of visible) {
    const key = new Date(m.created_at).toDateString();
    const last = days[days.length - 1];
    if (last?.key === key) last.items.push(m); else days.push({ key, label: dayLabel(m.created_at), items: [m] });
  }
  const typing = Object.entries(typers).filter(([id]) => !blocked.includes(id)).map(([, name]) => name);
  const subtitle = typing.length === 1 ? `${typing[0]} está digitando…`
    : typing.length === 2 ? `${typing[0]} e ${typing[1]} estão digitando…`
    : typing.length > 2 ? `${typing.length} pessoas estão digitando…`
    : online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} no app agora` : 'toque para ver os dados do grupo';
  const menuMessage = menu ? byId.get(menu.message.id) ?? menu.message : null;

  return <section className={`chat fill ${info ? 'with-info' : ''}`} aria-label="Chat da comunidade">
    <div className="chat-main" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      {/* Atrás de tudo, inclusive da barra de digitar, que flutua sobre ele. */}
      <div className="chat-wallpaper" aria-hidden />
      <header className="chat-header">
        <button className="icon-button chat-back only-mobile" onClick={() => router.replace('/')} aria-label="Voltar para o início"><ArrowLeft size={22} /></button>
        <button className="chat-title" onClick={() => setInfo('info')} aria-label="Dados do grupo">
          <img src="/images/logo.png" alt="" className="chat-avatar" />
          <span>
            <h1>Torcida Solar</h1>
            <small className={typing.length ? 'typing' : ''} aria-live="polite">{subtitle}</small>
          </span>
        </button>
        <button className="icon-button" onClick={() => setHeaderMenu(true)} aria-label="Mais opções" aria-haspopup="menu"><EllipsisVertical size={22} /></button>
      </header>
      {headerMenu && <div className="menu-layer" onClick={() => setHeaderMenu(false)}>
        <div className="menu-list header-menu" role="menu">
          <button role="menuitem" onClick={() => { setHeaderMenu(false); setInfo('info'); }}><span>Dados do grupo</span></button>
          <button role="menuitem" onClick={() => { setHeaderMenu(false); setInfo('blocked'); }}><span>Pessoas bloqueadas</span></button>
        </div>
      </div>}
      <button className="chat-pinned" onClick={() => setInfo('info')}>
        <span className="pinned-text"><small>Mensagem fixada</small><span>Respeito é a nossa principal regra. Boa torcida!</span></span><Pin size={18} />
      </button>

      <div className="chat-body">
        <div className="chat-messages" ref={list} onScroll={onScroll} role="log" aria-label="Mensagens da comunidade" aria-live="polite">
          {loadingOlder && <p className="chat-notice"><span className="spinner" /></p>}
          {status === 'loading' && <p className="chat-notice">Carregando conversa…</p>}
          {status === 'error' && <p className="chat-notice">Não foi possível carregar o chat. Verifique sua conexão.</p>}
          {status === 'ready' && visible.length === 0 && <p className="chat-notice">Ninguém falou nada ainda. Puxe o assunto! ☀️</p>}
          {days.map(day => <section key={day.key} className="chat-day-group">
            <div className="chat-day"><span>{day.label}</span></div>
            {day.items.map((message, index) => {
              const unread = message.id === firstUnread;
              const first = unread || index === 0 || day.items[index - 1].user_id !== message.user_id;
              return <div key={message.id} className="msg-slot">
                {unread && <div className="unread-divider"><span>{unreadCount} {unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}</span></div>}
                <MessageRow message={message} first={first} userId={userId} reply={replyOf(message)} flash={flash === message.id}
                  onMenu={setMenu} onReply={startReply} onOpen={setViewer} onJump={id => void jumpTo(id)} onReactors={setReactorsOf} />
              </div>;
            })}
          </section>)}
        </div>
        {!atBottom && <button className="scroll-down" onClick={scrollToBottom} aria-label={newCount > 0 ? `${newCount} novas mensagens. Ir para o fim` : 'Ir para o fim da conversa'}>
          <ChevronDown size={24} />
          {newCount > 0 && <span className="badge">{newCount > 99 ? '99+' : newCount}</span>}
        </button>}
      </div>

      {userId ? <Compose text={text} setText={setText} context={context} userId={userId} inputRef={input}
        onCancelContext={cancelContext} onSubmit={submit} onFile={chooseFile} onTyping={sendTyping} />
        : <div className="chat-login">
          <p>Entre para mandar mensagens, fotos e reagir.</p>
          <button className="button primary" onClick={() => requireLogin('Entre para conversar com a torcida.')}><LogIn size={16} /> Entrar</button>
        </div>}
    </div>

    <GroupInfo open={!!info} focusBlocked={info === 'blocked'} online={online} blocked={blocked} onUnblock={id => void unblock(id)} onClose={() => setInfo(null)} />

    {menu && menuMessage && <MessageMenu request={menu} own={menuMessage.user_id === userId}
      myReaction={menuMessage.reactions.find(r => r.user_id === userId)?.emoji ?? null} actions={actionsFor(menuMessage)} onAction={id => runAction(menuMessage, id)}
      onReact={emoji => void react(menuMessage, emoji)} onMoreReactions={() => { setMenu(null); setReactPicker(menuMessage); }} onClose={() => setMenu(null)}>
      <div className={`msg ${menuMessage.user_id === userId ? 'own' : 'in'} ${menu.first ? 'first' : ''}`}>
        <Bubble message={menuMessage} first={menu.first} userId={userId} reply={replyOf(menuMessage)} />
      </div>
    </MessageMenu>}
    <Sheet open={!!reactPicker} onClose={() => setReactPicker(null)} title="Reagir">
      {reactPicker && <EmojiPicker className="in-sheet" onPick={emoji => void react(reactPicker, emoji)} />}
    </Sheet>
    <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''}>
      {confirm && <div className="confirm">
        <p>{confirm.text}</p>
        <div><button className="button" onClick={() => setConfirm(null)}>Cancelar</button>
          <button className="button danger-solid" onClick={() => { setConfirm(null); confirm.run(); }}>{confirm.label}</button></div>
      </div>}
    </Sheet>
    <Reactors message={reactorsOf} userId={userId} onClose={() => setReactorsOf(null)} onRemove={message => { setReactorsOf(null); void react(message, message.reactions.find(r => r.user_id === userId)!.emoji); }} />
    <Viewer message={viewer} userId={userId} onClose={() => setViewer(null)} />
    <MediaSend key={pick?.url} pick={pick} onClose={closePick} onSend={sendPick} />
  </section>;
}
