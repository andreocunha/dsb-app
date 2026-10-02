'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, AtSign, Ban, ChevronDown, Copy, EllipsisVertical, Flag, LogIn, Pencil, Pin, Reply as ReplyIcon, Trash2, UserX } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { dayLabel, fold, hasMentionAll, mentionedIds, mentionsMe } from '@/lib/chat-format';
import { makeThumbnail, MAX_FILE_SIZE, storageName } from '@/lib/media';
import { shortName } from '@/lib/names';
import { clearChatNotifications } from '@/lib/push';
import { supabase, errorMessage } from '@/lib/supabase';
import type { Recording } from '@/lib/voice';
import { lastReadId, useApp, useChatUnread, useOnline, useOnlineUsers } from '../app-shell';
import { useAuth } from '../auth';
import { Avatar, Sheet } from '../ui';
import { Compose, type ComposeContext } from './compose';
import { EmojiPicker } from './emoji-picker';
import { bucketFor } from './files';
import { InfoPanel } from './group-info';
import { GroupAvatar, useGroupMembers } from './groups';
import { MediaSend, type Pick } from './media-send';
import { ALL, MentionPeople, useMentionables, usePeople, type MentionContext } from './mentions';
import { Bubble, MessageRow, type MenuRequest, type Receipts, type VoiceInfo } from './message';
import { MessageMenu, type MenuAction } from './message-menu';
import { Reactors } from './reactors';
import { canEdit, eventText, isAudio, isImage, targetKey, toReply, type GroupEvent, type Message, type Person, type Reaction, type Reply, type Row, type Target } from './types';
import { Viewer } from './viewer';

const PAGE = 50;
const TYPING_EVERY = 3000;
const TYPING_TTL = 5000;
const MAX_JUMP_PAGES = 10;
const NOBODY: string[] = [];
const NO_PEOPLE: Person[] = [];
type Confirm = { title: string; text: string; label: string; run: () => void };

async function fetchPage(conversationId: string | null, before?: number) {
  const { data, error } = await supabase.rpc('chat_messages', { p_before: before, p_limit: PAGE, p_conversation_id: conversationId ?? undefined });
  return error ? null : (data as unknown as Message[]).reverse();
}

// Mensagens ainda enviando ficam sempre no fim, na ordem em que saíram.
const order = (m: Message) => m.pending ? Number.MAX_SAFE_INTEGER : m.id;
const sorted = (list: Message[]) => [...list].sort((a, b) => order(a) - order(b));
const wiped = (m: Message, by: string | null): Message =>
  ({ ...m, deleted_at: new Date().toISOString(), deleted_by: by, body: null, file_path: null, thumb_path: null, file_name: null, file_type: null, reactions: [] });

/**
 * Uma conversa, como no WhatsApp: o grupo geral (fotos e nomes de quem escreve, moderação),
 * uma conversa particular (tiques azuis quando a outra pessoa lê, "online", bloqueio)
 * ou um grupo criado pelas pessoas (participantes, admins e tiques azuis quando todos leem).
 */
export function Conversation({ target, blocked, onBlock, onUnblock, onBack, onSeen, onOpenPerson, onLeft }: {
  target: Target; blocked: string[];
  onBlock: (person: Person, messageId?: number) => void; onUnblock: (id: string) => void;
  onBack: () => void; onSeen: (key: string) => void; onOpenPerson: (person: Person) => void; onLeft: () => void;
}) {
  const { userId, profile, requireLogin } = useAuth();
  const general = target.kind === 'general';
  const group = target.kind === 'group' ? target.group : null;
  // Várias pessoas (grupo geral ou criado): foto e nome de quem escreve, menções, e quem você bloqueou some.
  const multi = target.kind !== 'direct';
  const conversationId = target.kind === 'general' ? null : target.id;
  const other = target.kind === 'direct' ? target.other : null;
  const key = targetKey(target);
  // Moderação: a organização pode remover qualquer mensagem do grupo geral.
  const moderador = general && profile?.role === 'moderator';
  const { notify } = useApp();
  const { markRead, refreshDm } = useChatUnread();
  const online = useOnline();
  const onlineUsers = useOnlineUsers();
  // Só nos grupos dá para marcar pessoas com @: no geral, qualquer pessoa do app; nos outros, quem participa.
  const everyone = usePeople(general);
  const { members, reload: reloadMembers } = useGroupMembers(group ? conversationId : null);
  const people = general ? everyone : group ? members ?? NO_PEOPLE : NO_PEOPLE;
  // @all: num grupo criado qualquer participante marca todo mundo; no grupo geral (o app inteiro), só a organização.
  const canMentionAll = !!group || moderador;
  const mentionables = useMentionables(people);
  const mentionContext: MentionContext = { people: mentionables, me: userId, onOpen: id => { const person = people.find(p => p.id === id); if (person) onOpenPerson(person); } };
  // Menções a você que ainda não foram vistas: o botão @ acima do "descer" leva a cada uma, como no WhatsApp.
  const [mentionedMe, setMentionedMe] = useState<number[]>([]);
  // Quem foi escolhido na lista do @ para a mensagem que está sendo escrita.
  const picked = useRef<Person[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
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
  // Quem está digitando ou gravando áudio agora (o WhatsApp mostra os dois no topo).
  const [typers, setTypers] = useState<Record<string, { name: string; audio: boolean }>>({});
  const [flash, setFlash] = useState<number | null>(null);
  // Faixa "N mensagens não lidas": o que chegou entre a última visita e a abertura da conversa.
  const [readAtOpen, setReadAtOpen] = useState(() => general ? lastReadId() : 0);
  const [unreadUpTo, setUnreadUpTo] = useState(0);
  // Até onde cada outra pessoa da conversa recebeu (✓✓) e leu (✓✓ azul).
  const [reads, setReads] = useState<Record<string, Receipts>>({});
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
  const lastSeen = useRef(0);
  const draft = useRef('');
  const known = useRef(new Set<number>());
  const latestId = useRef(0);

  /**
   * Marca como lida: no aparelho para o grupo, no banco para as particulares (é o que acende o azul do outro lado).
   * Só com a tela visível: conversa aberta numa aba escondida não conta como lida, como no WhatsApp.
   */
  const markSeen = useCallback((lastId: number) => {
    if (lastId <= 0 || lastId <= lastSeen.current || document.visibilityState !== 'visible') return;
    lastSeen.current = lastId;
    void clearChatNotifications(key);
    if (!conversationId) { markRead(lastId); return; }
    void supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId, p_last_id: lastId }).then(() => { refreshDm(); onSeen(key); });
  }, [conversationId, key, markRead, refreshDm, onSeen]);

  const applyPage = useCallback((page: Message[] | null, before?: number) => {
    if (!page) { if (before) notify('Não foi possível carregar as mensagens anteriores.'); else setStatus('error'); return; }
    if (before) prependFrom.current = list.current?.scrollHeight ?? null;
    setMessages(current => before ? [...page.filter(m => !current.some(c => c.id === m.id)), ...current] : page);
    setHasMore(page.length === PAGE);
    setStatus('ready');
    if (!before && page.length) {
      setUnreadUpTo(page[page.length - 1].id);
      markSeen(page[page.length - 1].id);
    }
  }, [markSeen, notify]);

  useEffect(() => {
    known.current = new Set(messages.map(m => m.id));
    latestId.current = messages.findLast(m => !m.pending)?.id ?? 0;
  }, [messages]);

  // Voltou para a aba ou para o app com a conversa no fim: agora sim, lida.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && stickToBottom.current) markSeen(latestId.current); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markSeen]);

  // Carga inicial + tempo real (mensagens, reações, leituras e quem está digitando).
  useEffect(() => {
    let alive = true;
    if (conversationId) {
      // Na particular e nos grupos, a faixa de não lidas e os tiques vêm das leituras salvas no banco.
      void Promise.all([
        fetchPage(conversationId),
        supabase.from('conversation_reads').select('user_id, last_read_id, last_delivered_id').eq('conversation_id', conversationId),
      ]).then(([page, saved]) => {
        if (!alive) return;
        const myRead = saved.data?.find(r => r.user_id === userId)?.last_read_id ?? 0;
        setReadAtOpen(myRead);
        setReads(Object.fromEntries((saved.data ?? []).filter(r => r.user_id !== userId)
          .map(r => [r.user_id, { read: r.last_read_id, delivered: Math.max(r.last_delivered_id, r.last_read_id) }])));
        // Menções a você no grupo que chegaram desde a última leitura: o botão @ leva a cada uma.
        if (userId && page) setMentionedMe(page.filter(m => m.id > myRead && !m.deleted_at && mentionsMe(m, userId)).map(m => m.id));
        applyPage(page);
      });
    } else {
      void fetchPage(null).then(page => { if (alive) applyPage(page); });
      if (userId) void supabase.rpc('my_mentions', { p_after: lastReadId() }).then(({ data }) => { if (alive && data?.length) setMentionedMe(data); });
    }

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const stopTyping = (id: string) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      setTypers(current => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next; });
    };
    const upsertReaction = (reaction: Reaction & { message_id: number }) => setMessages(current => current.map(m => m.id !== reaction.message_id ? m
      : { ...m, reactions: [...m.reactions.filter(r => r.user_id !== reaction.user_id), { user_id: reaction.user_id, emoji: reaction.emoji }] }));
    // O Realtime só entrega a cada pessoa o que ela pode ler (RLS); aqui separamos a conversa aberta.
    const filter = conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {};
    const mine = (row: { conversation_id?: string | null }) => (row.conversation_id ?? null) === conversationId;
    let realtime = supabase.channel(`chat:${key}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...filter }, ({ new: payload }) => {
        const row = payload as Row;
        if (!mine(row)) return;
        stopTyping(row.user_id);
        // Alguém entrou ou saiu do grupo: a lista de participantes muda.
        if (row.event) reloadMembers();
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
        if (stickToBottom.current) markSeen(row.id);
        else {
          setNewCount(count => count + 1);
          if (mentionsMe(row, userId)) setMentionedMe(current => [...current, row.id]);
        }
      })
      // Edições, e a pessoa que trocou o nome e teve as mensagens antigas atualizadas.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', ...filter }, ({ new: row }) => {
        if (mine(row)) setMessages(current => current.map(m => m.id === row.id ? { ...m, ...(row as Row) } : m));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) =>
        setMessages(current => current.filter(m => m.id !== old.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old }) =>
        setMessages(current => current.map(m => m.id !== old.message_id ? m : { ...m, reactions: m.reactions.filter(r => r.user_id !== old.user_id) })))
      // Alguém ouviu uma mensagem de voz: o microfone fica azul.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_plays' }, ({ new: row }) => {
        const play = row as { message_id: number; user_id: string };
        setMessages(current => current.map(m => m.id !== play.message_id ? m
          : play.user_id === userId ? { ...m, played_by_me: true } : { ...m, played_by_others: true }));
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { id, name, audio } = payload as { id: string; name: string; audio?: boolean };
        if (typeof id !== 'string' || typeof name !== 'string') return;
        const next = { name: name.slice(0, 40), audio: audio === true };
        setTypers(current => current[id]?.name === next.name && current[id]?.audio === next.audio ? current : { ...current, [id]: next });
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => stopTyping(id), TYPING_TTL));
      });
    if (conversationId) {
      const onRead = ({ new: row }: { new: Record<string, unknown> }) => {
        const id = row.user_id;
        if (typeof id !== 'string' || id === userId) return;
        const read = Number(row.last_read_id) || 0, delivered = Number(row.last_delivered_id) || 0;
        setReads(current => ({ ...current, [id]: { read: Math.max(current[id]?.read ?? 0, read), delivered: Math.max(current[id]?.delivered ?? 0, delivered, read) } }));
      };
      realtime = realtime
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, onRead)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` }, onRead)
        // Grupo: alguém virou admin, saiu ou foi removido (inclusive você).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` }, () => reloadMembers());
    }
    realtime.subscribe();
    channel.current = realtime;
    return () => { alive = false; channel.current = null; timers.forEach(clearTimeout); void supabase.removeChannel(realtime); };
  }, [applyPage, markSeen, reloadMembers, conversationId, key, userId]);

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
    setMentionedMe([]);
    const lastId = messages.findLast(m => !m.pending)?.id;
    if (lastId) markSeen(lastId);
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
    applyPage(await fetchPage(conversationId, oldest), oldest);
    setLoadingOlder(false);
  }

  /** Toque na citação: rola até a original (carregando as anteriores se precisar) e ela pisca. */
  async function jumpTo(id: number) {
    let found = messages.some(m => m.id === id);
    let oldest = messages.find(m => !m.pending)?.id;
    let more = hasMore;
    for (let i = 0; !found && more && oldest && i < MAX_JUMP_PAGES; i++) {
      const page = await fetchPage(conversationId, oldest);
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

  /** Toque no @: vai para a menção mais antiga ainda não vista, e ela sai da fila. */
  function nextMention() {
    const [id, ...rest] = mentionedMe;
    setMentionedMe(rest);
    if (id) void jumpTo(id);
  }

  function sendTyping() {
    if (!userId || !profile || Date.now() - lastTyping.current < TYPING_EVERY) return;
    lastTyping.current = Date.now();
    void channel.current?.send({ type: 'broadcast', event: 'typing', payload: { id: userId, name: shortName(profile.name), audio: false } });
  }
  // "Gravando áudio…" a cada 3s enquanto grava (estável: o gravador usa como dependência).
  const sendRecording = useCallback(() => {
    if (!userId || !profile) return;
    void channel.current?.send({ type: 'broadcast', event: 'typing', payload: { id: userId, name: shortName(profile.name), audio: true } });
  }, [userId, profile]);

  /** Mensagem de voz pronta: vai como arquivo de áudio, com a duração e a forma de onda. */
  function sendVoice(recording: Recording) {
    const ext = recording.type.includes('mp4') ? 'm4a' : recording.type.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([recording.blob], `mensagem-de-voz.${ext}`, { type: recording.type.split(';')[0] });
    void send({ body: '', file, localUrl: URL.createObjectURL(recording.blob), replyTo: context?.kind === 'reply' ? context.message : null,
      voice: { durationMs: recording.durationMs, waveform: recording.waveform } });
    if (context?.kind === 'reply') setContext(null);
  }

  function markPlayed(message: Message) {
    setMessages(current => current.map(m => m.id === message.id ? { ...m, played_by_me: true } : m));
    void supabase.rpc('mark_played', { p_message_id: message.id });
  }

  /** Aparece na hora com o relógio; o ✓ entra quando o banco confirma. */
  async function send({ body, file, localUrl, replyTo, voice }: {
    body: string; file?: File; localUrl?: string; replyTo: Message | null; voice?: { durationMs: number; waveform: number[] };
  }) {
    if (!userId || !profile) { requireLogin('Entre para conversar com a torcida.'); return; }
    const tempId = -Date.now();
    const reply = replyTo ? toReply(replyTo) : null;
    const bucket = bucketFor(conversationId);
    const mentions = multi && body ? whoIsMentioned(body) : [];
    const mentionAll = canMentionAll && hasMentionAll(body);
    stickToBottom.current = true;
    lastTyping.current = 0;
    setNewCount(0);
    setUnreadUpTo(0);
    setMessages(current => [...current, {
      id: tempId, user_id: userId, author_name: profile.name, author_avatar: profile.avatar_url, body: body || null,
      file_path: file ? 'pending' : null, file_name: file?.name ?? null, file_type: file ? file.type || 'application/octet-stream' : null,
      file_size: file?.size ?? null, thumb_path: null, width: null, height: null, created_at: new Date().toISOString(),
      deleted_at: null, deleted_by: null, reply_to: replyTo?.id ?? null, edited_at: null, conversation_id: conversationId,
      duration_ms: voice?.durationMs ?? null, waveform: voice?.waveform ?? null, mentions, mention_all: mentionAll, event: null,
      reactions: [], reply, pending: true, localUrl,
    }]);
    const uploaded: string[] = [];
    try {
      const args: Database['public']['Functions']['send_message']['Args'] = {
        p_body: body || undefined, p_reply_to: replyTo?.id, p_conversation_id: conversationId ?? undefined,
        p_duration_ms: voice?.durationMs, p_waveform: voice?.waveform,
        // Só vai quando há menção: assim o envio comum não depende da versão do banco.
        ...(mentions.length ? { p_mentions: mentions } : {}),
      };
      if (file) {
        // Grupo: pasta da pessoa no bucket público. Particular: pasta da conversa no bucket privado.
        const folder = `${conversationId ? `${conversationId}/` : ''}${userId}/${crypto.randomUUID()}`;
        const path = `${folder}/${storageName(file.name)}`;
        const [thumb, upload] = await Promise.all([
          makeThumbnail(file),
          supabase.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream', cacheControl: '31536000' }),
        ]);
        if (upload.error) throw upload.error;
        uploaded.push(path);
        Object.assign(args, { p_file_path: path, p_file_name: file.name });
        if (thumb) {
          const thumbPath = `${folder}/.thumb.jpg`;
          const { error } = await supabase.storage.from(bucket).upload(thumbPath, thumb.blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
          if (!error) { uploaded.push(thumbPath); Object.assign(args, { p_thumb_path: thumbPath, p_width: thumb.width, p_height: thumb.height }); }
        }
      }
      const { data, error } = await supabase.rpc('send_message', args);
      if (error) throw error;
      setMessages(current => sorted(current.filter(m => m.id !== data.id).map(m => m.id === tempId ? { ...data, reactions: [], reply, localUrl } : m)));
      markSeen(data.id);
    } catch (error) {
      if (uploaded.length) void supabase.storage.from(bucket).remove(uploaded);
      setMessages(current => current.filter(m => m.id !== tempId));
      // Falhou: o texto volta para o campo, para não se perder.
      if (!file && body) setText(current => current || body);
      notify(errorMessage(error));
    }
  }

  /**
   * Vale quem foi escolhido na lista e continua no texto. Nome digitado à mão também marca,
   * menos quando outra pessoa com o mesmo nome foi a escolhida.
   */
  function whoIsMentioned(body: string) {
    const text = fold(body);
    const chosen = picked.current.filter(p => text.includes(fold(`@${shortName(p.name)}`)));
    const names = new Set(chosen.map(p => fold(shortName(p.name))));
    const typed = mentionedIds(body, mentionables).filter(id => {
      const person = people.find(p => p.id === id);
      return person && !names.has(fold(shortName(person.name)));
    });
    picked.current = [];
    return [...new Set([...chosen.map(p => p.id), ...typed])].filter(id => id !== userId && id !== ALL.id);
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
    if (data?.length) void supabase.storage.from(bucketFor(conversationId)).remove(data);
  }

  async function report(message: Message) {
    const { error } = await supabase.rpc('report_message', { p_message_id: message.id });
    notify(error ? errorMessage(error) : 'Denúncia enviada. Obrigado por ajudar a manter o chat saudável.');
  }

  async function ban(message: Message) {
    const { error } = await supabase.rpc('ban_user', { p_user_id: message.user_id });
    if (error) { notify(errorMessage(error)); return; }
    setMessages(current => current.map(m => m.user_id !== message.user_id || m.deleted_at ? m : wiped(m, userId)));
    notify(`${shortName(message.author_name)} foi banido do chat e as mensagens saíram do ar.`);
  }

  function askBlock(person: Person, messageId?: number) {
    const name = shortName(person.name);
    setConfirm({
      title: `Bloquear ${name}?`,
      text: multi ? 'Você não verá mais as mensagens desta pessoa nos grupos, e a organização será avisada. Dá para desbloquear nos dados do grupo geral.'
        : 'Vocês não poderão mais trocar mensagens, e a organização será avisada. Dá para desbloquear quando quiser.',
      label: 'Bloquear',
      run: () => onBlock(person, messageId),
    });
  }

  function askLeave() {
    if (!group || !conversationId) return;
    setConfirm({
      title: `Sair do grupo "${group.name}"?`,
      text: othersInGroup.length ? 'Você deixa de receber as mensagens deste grupo. Para voltar, um admin precisa adicionar você.'
        : 'Você é a última pessoa do grupo: ao sair, ele e as mensagens são apagados.',
      label: 'Sair do grupo',
      run: () => void supabase.rpc('leave_group', { p_conversation: conversationId }).then(({ error }) => { if (error) notify(errorMessage(error)); else onLeft(); }),
    });
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
    if (!blocked.includes(message.user_id)) actions.push({ id: 'block', label: `Bloquear ${name}`, icon: <Ban size={20} />, danger: true });
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
      case 'delete': setConfirm({ title: 'Apagar mensagem?', text: multi ? 'A mensagem será apagada para todas as pessoas do grupo.' : `A mensagem será apagada para você e para ${other ? shortName(other.name) : 'a outra pessoa'}.`, label: 'Apagar para todos', run: () => void remove(message) }); break;
      case 'report': setConfirm({ title: `Denunciar ${name}?`, text: 'A organização vai analisar esta mensagem em até 24 horas. Quem mandou não fica sabendo.', label: 'Denunciar', run: () => void report(message) }); break;
      case 'block': askBlock({ id: message.user_id, name: message.author_name, avatar_url: message.author_avatar }, message.id); break;
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

  // Nos grupos some quem a pessoa bloqueou (menos os avisos); na particular a conversa continua visível, mas travada.
  const visible = multi ? messages.filter(m => m.event || !blocked.includes(m.user_id)) : messages;
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
    const day = new Date(m.created_at).toDateString();
    const last = days[days.length - 1];
    if (last?.key === day) last.items.push(m); else days.push({ key: day, label: dayLabel(m.created_at), items: [m] });
  }
  const typingNow = Object.entries(typers).filter(([id]) => !blocked.includes(id)).map(([, t]) => t);
  const typing = typingNow.map(t => t.name);
  const recordingNow = typingNow.length > 0 && typingNow.every(t => t.audio);
  const otherBlocked = !!other && blocked.includes(other.id);
  // Grupo: quem está nele (você por último, como no WhatsApp). Saiu ou foi removido: não dá mais para escrever.
  const othersInGroup = members?.filter(m => m.id !== userId) ?? [];
  const leftGroup = !!group && !!userId && members !== null && !members.some(m => m.id === userId);
  const subtitle = group && !typing.length
    ? (members ? [...othersInGroup.map(m => shortName(m.name)), ...(leftGroup ? [] : ['Você'])].join(', ') : 'clique para ver os dados do grupo')
    : other
    ? (typing.length ? (recordingNow ? 'gravando áudio…' : 'digitando…') : onlineUsers.has(other.id) ? 'online' : 'clique para ver os dados do contato')
    : typing.length === 1 ? `${typing[0]} está ${recordingNow ? 'gravando áudio' : 'digitando'}…`
    : typing.length === 2 ? `${typing[0]} e ${typing[1]} estão digitando…`
    : typing.length > 2 ? `${typing.length} pessoas estão digitando…`
    : online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} no app agora` : 'clique para ver os dados do grupo';
  const menuMessage = menu ? byId.get(menu.message.id) ?? menu.message : null;
  // Tiques: na particular, os da outra pessoa; no grupo, o menor de todos (azul só quando todo mundo leu).
  const receiptsOf = (ids: string[]): Receipts | null => ids.length
    ? { read: Math.min(...ids.map(id => reads[id]?.read ?? 0)), delivered: Math.min(...ids.map(id => reads[id]?.delivered ?? 0)) } : null;
  const tickState = other ? receiptsOf([other.id]) : group ? receiptsOf(othersInGroup.map(m => m.id)) : null;
  /** Microfone: verde (você não ouviu), azul (ouvido) ou cinza (seu, ainda não ouvido; no grupo aberto fica cinza). */
  const voiceOf = (m: Message, index: number): VoiceInfo | undefined => {
    if (!isAudio(m) || m.deleted_at) return undefined;
    const own = m.user_id === userId;
    const next = visible[index + 1];
    return {
      played: own ? (!general && m.played_by_others ? 'played' : 'sent') : m.played_by_me ? 'played' : 'new',
      nextId: next && isAudio(next) && !next.deleted_at ? next.id : null,
      onPlayed: markPlayed,
    };
  };
  const indexOf = new Map(visible.map((m, i) => [m.id, i]));

  return <MentionPeople value={mentionContext}><section className={`chat ${multi ? 'group' : 'direct'} ${info ? 'with-info' : ''}`} aria-label={other ? `Conversa com ${other.name}` : group ? `Grupo ${group.name}` : 'Chat da comunidade'}>
    <div className="chat-main" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
      {/* Atrás de tudo, inclusive da barra de digitar, que flutua sobre ele. */}
      <div className="chat-wallpaper" aria-hidden />
      <header className="chat-header">
        <button className="icon-button chat-back only-mobile" onClick={onBack} aria-label="Voltar para as conversas"><ArrowLeft size={22} /></button>
        <button className="chat-title" onClick={() => setInfo('info')} aria-label={other ? 'Dados do contato' : 'Dados do grupo'}>
          {other ? <Avatar id={other.id} name={other.name} url={other.avatar_url} />
            : group ? <GroupAvatar id={key} group={group} />
            : <img src="/images/logo.png" alt="" className="chat-avatar" />}
          <span>
            <h1>{other ? other.name : group ? group.name : 'Torcida Solar'}</h1>
            <small className={typing.length ? 'typing' : ''} aria-live="polite">{subtitle}</small>
          </span>
        </button>
        <button className="icon-button" onClick={() => setHeaderMenu(true)} aria-label="Mais opções" aria-haspopup="menu"><EllipsisVertical size={22} /></button>
      </header>
      {headerMenu && <div className="menu-layer" onClick={() => setHeaderMenu(false)}>
        <div className="menu-list header-menu" role="menu">
          <button role="menuitem" onClick={() => { setHeaderMenu(false); setInfo('info'); }}><span>{other ? 'Dados do contato' : 'Dados do grupo'}</span></button>
          {other
            ? <button role="menuitem" className="danger" onClick={() => { setHeaderMenu(false); if (otherBlocked) onUnblock(other.id); else askBlock(other); }}><span>{otherBlocked ? 'Desbloquear' : 'Bloquear'}</span></button>
            : group ? !leftGroup && <button role="menuitem" className="danger" onClick={() => { setHeaderMenu(false); askLeave(); }}><span>Sair do grupo</span></button>
            : <button role="menuitem" onClick={() => { setHeaderMenu(false); setInfo('blocked'); }}><span>Pessoas bloqueadas</span></button>}
          <button role="menuitem" onClick={() => { setHeaderMenu(false); onBack(); }}><span>Fechar conversa</span></button>
        </div>
      </div>}
      {general && <button className="chat-pinned" onClick={() => setInfo('info')}>
        <span className="pinned-text"><small>Mensagem fixada</small><span>Respeito é a nossa principal regra. Boa torcida!</span></span><Pin size={18} />
      </button>}

      <div className="chat-body">
        <div className="chat-messages" ref={list} onScroll={onScroll} role="log" aria-label="Mensagens" aria-live="polite">
          {loadingOlder && <p className="chat-notice"><span className="spinner" /></p>}
          {other && status === 'ready' && !hasMore && <p className="chat-notice notice-private">🔒 Só você e {shortName(other.name)} veem as mensagens desta conversa. Denúncias continuam indo para a organização.</p>}
          {group && status === 'ready' && !hasMore && <p className="chat-notice notice-private">🔒 Só quem participa deste grupo vê as mensagens, e só as que chegaram depois de entrar. Denúncias continuam indo para a organização.</p>}
          {status === 'loading' && <p className="chat-notice">Carregando conversa…</p>}
          {status === 'error' && <p className="chat-notice">Não foi possível carregar a conversa. Verifique sua conexão.</p>}
          {status === 'ready' && general && visible.length === 0 && <p className="chat-notice">Ninguém falou nada ainda. Puxe o assunto! ☀️</p>}
          {days.map(day => <section key={day.key} className="chat-day-group">
            <div className="chat-day"><span>{day.label}</span></div>
            {day.items.map((message, index) => {
              const unread = message.id === firstUnread;
              const previous = day.items[index - 1];
              const first = unread || !previous || previous.user_id !== message.user_id || !!previous.event;
              return <div key={message.id} className="msg-slot">
                {unread && <div className="unread-divider"><span>{unreadCount} {unreadCount === 1 ? 'mensagem não lida' : 'mensagens não lidas'}</span></div>}
                {message.event ? <p id={`m-${message.id}`} className="chat-notice chat-event">{eventText(message.event as GroupEvent, message, userId)}</p>
                : <MessageRow message={message} first={first} userId={userId} reply={replyOf(message)} flash={flash === message.id} group={multi} receipts={tickState}
                  voice={voiceOf(message, indexOf.get(message.id) ?? -1)}
                  onMenu={setMenu} onReply={startReply} onOpen={setViewer} onJump={id => void jumpTo(id)} onReactors={setReactorsOf} />}
              </div>;
            })}
          </section>)}
        </div>
        {!atBottom && mentionedMe.some(id => !blocked.includes(byId.get(id)?.user_id ?? '')) && <button className="scroll-down scroll-mention" onClick={nextMention}
          aria-label={`${mentionedMe.length} ${mentionedMe.length === 1 ? 'menção' : 'menções'} a você. Ir para a próxima`}>
          <AtSign size={22} />
        </button>}
        {!atBottom && <button className="scroll-down" onClick={scrollToBottom} aria-label={newCount > 0 ? `${newCount} novas mensagens. Ir para o fim` : 'Ir para o fim da conversa'}>
          <ChevronDown size={24} />
          {newCount > 0 && <span className="badge">{newCount > 99 ? '99+' : newCount}</span>}
        </button>}
      </div>

      {!userId ? <div className="chat-login">
          <p>Entre para mandar mensagens, fotos e reagir.</p>
          <button className="button primary" onClick={() => requireLogin('Entre para conversar com a torcida.')}><LogIn size={16} /> Entrar</button>
        </div>
        : otherBlocked ? <button className="chat-login blocked-bar" onClick={() => onUnblock(other.id)}>
          Você bloqueou este contato. Toque para desbloquear.
        </button>
        : leftGroup ? <p className="chat-login blocked-bar">Você não faz mais parte deste grupo.</p>
        : <Compose text={text} setText={setText} context={context} userId={userId} people={multi ? people : undefined} mentionAll={canMentionAll} onMention={person => { picked.current = [...picked.current, person]; }} inputRef={input}
          onCancelContext={cancelContext} onSubmit={submit} onFile={chooseFile} onTyping={() => sendTyping()}
          onVoice={sendVoice} onRecording={sendRecording} onError={notify} />}
    </div>

    <InfoPanel key={`info-${info ?? 'fechado'}`} target={target} open={!!info} initialView={info === 'blocked' ? 'blocked' : 'info'} online={online}
      contactOnline={!!other && onlineUsers.has(other.id)} blocked={blocked} members={members} onUnblock={onUnblock}
      onBlock={person => askBlock(person, messages.findLast(m => m.user_id === person.id && !m.deleted_at)?.id)}
      onOpenMedia={setViewer} onOpenPerson={onOpenPerson} onLeft={onLeft} onMembersChanged={reloadMembers} onClose={() => setInfo(null)} />

    {menu && menuMessage && <MessageMenu request={menu} own={menuMessage.user_id === userId}
      myReaction={menuMessage.reactions.find(r => r.user_id === userId)?.emoji ?? null} actions={actionsFor(menuMessage)} onAction={id => runAction(menuMessage, id)}
      onReact={emoji => void react(menuMessage, emoji)} onMoreReactions={() => { setMenu(null); setReactPicker(menuMessage); }} onClose={() => setMenu(null)}>
      <div className={`msg ${menuMessage.user_id === userId ? 'own' : 'in'} ${menu.first ? 'first' : ''}`}>
        <Bubble message={menuMessage} first={menu.first} userId={userId} reply={replyOf(menuMessage)} group={multi} receipts={tickState} />
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
    <Viewer key={`viewer-${viewer?.id ?? 'fechado'}`} message={viewer} userId={userId} blocked={multi ? blocked : NOBODY}
      myReaction={id => byId.get(id)?.reactions.find(r => r.user_id === userId)?.emoji ?? null}
      onClose={() => setViewer(null)}
      onJump={m => { setViewer(null); setInfo(null); void jumpTo(m.id); }}
      onReply={m => { setViewer(null); setInfo(null); startReply(byId.get(m.id) ?? m); }}
      onReact={(m, emoji) => void react(byId.get(m.id) ?? m, emoji)} />
    <MediaSend key={`media-${pick?.url ?? 'fechado'}`} pick={pick} onClose={closePick} onSend={sendPick} />
  </section></MentionPeople>;
}
