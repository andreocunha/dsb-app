'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Ban, Camera, Check, CheckCheck, EllipsisVertical, FileText, Lock, LogIn, MapPin, MessageSquarePlus, Mic, Pin, Search, Users, Video, X } from 'lucide-react';
import { formatDuration } from '@/lib/voice';
import { listTime, mentionsMe } from '@/lib/chat-format';
import { asPlace, placeLabel } from '@/lib/location';
import { shortName } from '@/lib/names';
import { supabase, errorMessage } from '@/lib/supabase';
import { useApp, useChatUnread, useOnlineUsers } from '../app-shell';
import { useAuth } from '../auth';
import { Avatar } from '../ui';
import { forgetConversation } from './cache';
import { Conversation } from './chat';
import { useGeneralReceipts } from './general-receipts';
import { GroupAvatar, JoinGroup, NewGroup } from './groups';
import { eventText, GROUP_KEY, targetKey, type GroupEvent, type GroupInfo, type Person, type Target } from './types';
import { useWide, WIDE } from './use-wide';

type Last = { id: number; user_id: string; author_name?: string; body: string | null; file_type: string | null; file_name: string | null; created_at: string; deleted: boolean; duration_ms?: number | null; played?: boolean; event?: GroupEvent | null; location?: unknown };
/** Conversa da lista: particular (other) ou grupo criado pelas pessoas (group). */
type Chat = { id: string; other: Person | null; group: GroupInfo | null; last: Last | null; unread: number; mentions: number; otherRead: number; otherDelivered: number };
type Filter = 'all' | 'unread' | 'groups';

const GENERAL: Target = { kind: 'general' };
const chatName = (c: Chat) => c.group?.name ?? c.other?.name ?? '';
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Tela de conversas, como no WhatsApp: no celular, a lista e depois a conversa em tela cheia;
 * no desktop, a lista à esquerda e a conversa à direita (WhatsApp Web).
 * O grupo geral fica sempre fixado no topo; dá para conversar em particular com qualquer pessoa que entrou no app
 * e criar grupos com quem quiser.
 */
export function Chats() {
  // Trocar de conta (ou sair) começa a tela do zero: nada da conta anterior fica na lista ou aberto.
  const { userId } = useAuth();
  return <ChatsScreen key={userId ?? 'visitante'} />;
}

function ChatsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('c');
  // Link de convite de um grupo (?convite=): a folha "Entrar no grupo" aparece por cima das conversas.
  const invite = params.get('convite');
  const { userId, requireLogin } = useAuth();
  const { notify } = useApp();
  const { unread: groupUnread, mentions: groupMentions } = useChatUnread();
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [groupLast, setGroupLast] = useState<Last | null>(null);
  const [extra, setExtra] = useState<Target | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [newChat, setNewChat] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  // A conversa foi aberta a partir da lista neste celular: fechar é voltar no histórico.
  const pushed = useRef(false);
  const openRef = useRef(open);
  const chatsRef = useRef(chats);
  useEffect(() => { openRef.current = open; chatsRef.current = chats; }, [open, chats]);

  const loadChats = useCallback(() => {
    if (!userId) return;
    void supabase.rpc('my_conversations').then(({ data }) => setChats((data ?? []).map(row => ({
      id: row.id,
      other: !row.is_group && row.other_id ? { id: row.other_id, name: row.other_name ?? '', avatar_url: row.other_avatar } : null,
      group: row.is_group ? { name: row.name ?? '', photo_path: row.photo_path, description: row.description } : null,
      last: row.last as unknown as Last | null, unread: row.unread, mentions: row.mentions ?? 0,
      otherRead: row.other_read_id, otherDelivered: row.other_delivered_id,
    }))));
  }, [userId]);

  useEffect(() => {
    loadChats();
    void supabase.rpc('chat_messages', { p_limit: 1 }).then(({ data }) => {
      const m = data?.[0];
      if (m) setGroupLast({ id: m.id, user_id: m.user_id, author_name: m.author_name, body: m.body, file_type: m.file_type, file_name: m.file_name, created_at: m.created_at, deleted: !!m.deleted_at, duration_ms: m.duration_ms, played: m.played_by_me, location: m.location });
    });
    if (userId) void supabase.from('user_blocks').select('blocked_id').then(({ data }) => setBlocked((data ?? []).map(b => b.blocked_id)));
  }, [userId, loadChats]);

  // Tempo real da lista: última mensagem, não lidas e tiques de cada conversa.
  useEffect(() => {
    const channel = supabase.channel('chats-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const last: Last = { id: row.id, user_id: row.user_id, author_name: row.author_name, body: row.body, file_type: row.file_type, file_name: row.file_name, created_at: row.created_at, deleted: false, duration_ms: row.duration_ms, played: false, event: row.event, location: row.location };
        if (!row.conversation_id) { setGroupLast(last); return; }
        // Conversa nova (a outra pessoa acabou de puxar papo): recarrega a lista.
        if (!chatsRef.current?.some(c => c.id === row.conversation_id)) { loadChats(); return; }
        const viewing = openRef.current === row.conversation_id;
        const counts = row.user_id !== userId && !viewing;
        setChats(current => current?.map(c => c.id !== row.conversation_id ? c
          : { ...c, last, unread: counts ? c.unread + 1 : c.unread, mentions: counts && mentionsMe(row as Parameters<typeof mentionsMe>[0], userId) ? c.mentions + 1 : c.mentions }) ?? current);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const patch = (last: Last | null): Last | null => last && last.id === row.id ? { ...last, body: row.body, file_type: row.file_type, file_name: row.file_name, location: row.location, deleted: !!row.deleted_at } : last;
        if (!row.conversation_id) setGroupLast(patch);
        else setChats(current => current?.map(c => c.id === row.conversation_id ? { ...c, last: patch(c.last) } : c) ?? current);
      })
      // Ouviram o último áudio: o microfone da prévia fica azul.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_plays' }, ({ new: row }) => {
        const play = row as { message_id: number; user_id: string };
        const mark = (last: Last | null): Last | null => last && last.id === play.message_id
          && (last.user_id === userId ? play.user_id !== userId : play.user_id === userId) ? { ...last, played: true } : last;
        setGroupLast(last => last && last.user_id !== userId ? mark(last) : last);
        setChats(current => current?.map(c => c.last?.id === play.message_id ? { ...c, last: mark(c.last) } : c) ?? current);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_reads' }, ({ new: row }) => {
        const read = row as { conversation_id?: string; user_id?: string; last_read_id?: number; last_delivered_id?: number };
        if (!read.conversation_id || read.user_id === userId) return;
        // No grupo o tique azul depende de todo mundo: quem sabe calcular é o banco (e só importa se a última é sua).
        const chat = chatsRef.current?.find(c => c.id === read.conversation_id);
        if (chat?.group) { if (chat.last?.user_id === userId) loadChats(); return; }
        setChats(current => current?.map(c => c.id !== read.conversation_id ? c : {
          ...c, otherRead: Math.max(c.otherRead, read.last_read_id ?? 0),
          otherDelivered: Math.max(c.otherDelivered, read.last_delivered_id ?? 0, read.last_read_id ?? 0),
        }) ?? current);
      })
      // Nome, foto ou descrição do grupo mudaram.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, ({ new: row }) => {
        if (!row.is_group) return;
        const group: GroupInfo = { name: row.name, photo_path: row.photo_path, description: row.description };
        setChats(current => current?.map(c => c.id === row.id ? { ...c, group } : c) ?? current);
        setExtra(current => current?.kind === 'group' && current.id === row.id ? { ...current, group } : current);
      });
    // Você saiu ou foi removido de um grupo (em outro aparelho ou por um admin): ele some da lista.
    if (userId) channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${userId}` }, ({ new: row }) => {
      if (!row.left_at) return;
      const gone = chatsRef.current?.find(c => c.id === row.conversation_id);
      setChats(current => current?.filter(c => c.id !== row.conversation_id) ?? current);
      if (gone && openRef.current === row.conversation_id) {
        notify(`Você não faz mais parte do grupo "${gone.group?.name ?? ''}".`);
        router.replace('/comunidade/');
      }
    });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, loadChats, notify, router]);

  // Conversa aberta pelo endereço que ainda não está na lista (acabou de ser criada ou não tem mensagens).
  const known = open === GROUP_KEY || chats?.some(c => c.id === open) || (extra && targetKey(extra) === open);
  useEffect(() => {
    if (!open || known || !userId || !UUID.test(open) || chats === null) return;
    let alive = true;
    void supabase.from('conversations').select('user_a, user_b, is_group, name, photo_path, description').eq('id', open).maybeSingle().then(async ({ data }) => {
      if (data?.is_group) {
        if (alive) setExtra({ kind: 'group', id: open, group: { name: data.name ?? '', photo_path: data.photo_path, description: data.description } });
        return;
      }
      const otherId = data ? (data.user_a === userId ? data.user_b : data.user_a) : null;
      const person = otherId ? (await supabase.from('profiles').select('id, name, avatar_url').eq('id', otherId).maybeSingle()).data : null;
      if (!alive) return;
      if (person) setExtra({ kind: 'direct', id: open, other: person });
      else router.replace('/comunidade/');
    });
    return () => { alive = false; };
  }, [open, known, userId, chats, router]);

  const go = useCallback((key: string | null) => {
    // No celular a conversa entra no histórico, para o voltar do sistema levar de volta à lista.
    if (!key && pushed.current) { pushed.current = false; router.back(); return; }
    const url = key ? `/comunidade/?c=${key}` : '/comunidade/';
    if (key && !openRef.current && !window.matchMedia(WIDE).matches) { pushed.current = true; router.push(url); } else router.replace(url);
  }, [router]);

  const onSeen = useCallback((key: string) => {
    setChats(current => current?.map(c => c.id === key ? { ...c, unread: 0, mentions: 0 } : c) ?? current);
  }, []);

  async function openPerson(person: Person) {
    if (!userId) { requireLogin('Entre para conversar em particular.'); return; }
    setNewChat(false);
    setNewGroup(false);
    const existing = chats?.find(c => c.other?.id === person.id);
    if (existing) { go(existing.id); return; }
    const { data, error } = await supabase.rpc('start_conversation', { p_user: person.id });
    if (error || !data) { notify(errorMessage(error)); return; }
    setExtra({ kind: 'direct', id: data, other: person });
    go(data);
  }

  function groupCreated(id: string, group: GroupInfo) {
    setNewGroup(false);
    setNewChat(false);
    setExtra({ kind: 'group', id, group });
    loadChats();
    go(id);
  }

  /** Entrou (ou já participava) pelo link de convite: a conversa do grupo abre no lugar do convite. */
  function joinedGroup(id: string, group: GroupInfo) {
    setExtra({ kind: 'group', id, group });
    loadChats();
    router.replace(`/comunidade/?c=${id}`);
  }

  /** Você saiu do grupo por aqui: some da lista na hora, sem esperar o tempo real. */
  function leftGroup(id: string) {
    forgetConversation(userId, id);
    setChats(current => current?.filter(c => c.id !== id) ?? current);
    if (extra && targetKey(extra) === id) setExtra(null);
    if (openRef.current === id) go(null);
  }

  async function block(person: Person, messageId?: number) {
    const { error } = await supabase.from('user_blocks').insert({ blocked_id: person.id });
    if (error && error.code !== '23505') { notify(errorMessage(error)); return; }
    // A App Store exige que bloquear também avise a organização sobre o conteúdo.
    if (messageId) void supabase.rpc('report_message', { p_message_id: messageId, p_reason: 'bloqueio' });
    setBlocked(current => [...new Set([...current, person.id])]);
    notify(`${shortName(person.name)} foi bloqueado. A organização foi avisada.`);
  }

  async function unblock(id: string) {
    const { error } = await supabase.from('user_blocks').delete().eq('blocked_id', id);
    if (error) { notify(errorMessage(error)); return; }
    setBlocked(current => current.filter(b => b !== id));
  }

  const chat = chats?.find(c => c.id === open);
  const target: Target | null = open === GROUP_KEY ? GENERAL
    : chat?.group ? { kind: 'group', id: chat.id, group: chat.group }
    : chat?.other ? { kind: 'direct', id: chat.id, other: chat.other }
    : extra && targetKey(extra) === open ? extra : null;
  const startGroup = () => { if (userId) { setNewChat(false); setNewGroup(true); } else requireLogin('Entre para criar grupos.'); };

  return <section className={`chats fill ${open ? 'open' : ''}`} aria-label="Conversas">
    <div className="chats-list">
      {newGroup
        ? <NewGroup blocked={blocked} onClose={() => setNewGroup(false)} onCreated={groupCreated} />
        : newChat
        ? <NewChat userId={userId} onClose={() => setNewChat(false)} onPick={person => void openPerson(person)} onGroup={startGroup} />
        : <ChatList userId={userId} chats={chats} groupLast={groupLast} groupUnread={groupUnread} groupMentions={groupMentions} open={open} blocked={blocked}
          onOpen={go} onNew={() => { if (userId) setNewChat(true); else requireLogin('Entre para conversar em particular.'); }} onNewGroup={startGroup}
          onPerson={person => void openPerson(person)} />}
    </div>
    <div className="chats-pane">
      {target
        ? <Conversation key={targetKey(target)} target={target} blocked={blocked} onBlock={(person, id) => void block(person, id)} onUnblock={id => void unblock(id)}
          onBack={() => go(null)} onSeen={onSeen} onOpenPerson={person => void openPerson(person)} onLeft={() => leftGroup(targetKey(target))} />
        : open && userId ? <div className="chats-intro"><span className="spinner" /></div>
        : <Intro onGroup={() => go(GROUP_KEY)} />}
    </div>
    {invite && <JoinGroup key={invite} code={invite} onJoined={joinedGroup}
      onClose={() => router.replace(open ? `/comunidade/?c=${open}` : '/comunidade/')} />}
  </section>;
}

/** Texto curto da última mensagem, como na lista do WhatsApp. */
function LastPreview({ last, userId, group, receipts }: { last: Last | null; userId: string | null; group: boolean; receipts: { read: number; delivered: number } | null }) {
  if (!last) return <span className="chat-row-preview">{group ? 'Toque para conversar com a torcida' : 'Nenhuma mensagem ainda'}</span>;
  const own = last.user_id === userId;
  // Aviso do grupo ("Ana adicionou você"): o texto já diz quem foi.
  if (last.event && !last.deleted) return <span className="chat-row-preview"><span>{eventText(last.event, { user_id: last.user_id, author_name: last.author_name ?? '' }, userId)}</span></span>;
  const who = group && !own && last.author_name ? `${shortName(last.author_name)}: ` : '';
  const tick = own && !last.deleted && (receipts && last.id <= receipts.read ? <CheckCheck size={16} className="tick-read" aria-label="Lida" />
    : receipts && last.id <= receipts.delivered ? <CheckCheck size={16} aria-label="Entregue" /> : <Check size={16} aria-label="Enviada" />);
  // Mensagem de voz: microfone verde (você não ouviu) ou azul (ouvida), como na lista do WhatsApp.
  const voice = !last.deleted && !!last.duration_ms;
  const place = last.deleted ? null : asPlace(last.location);
  const icon = last.deleted ? <Ban size={15} /> : place ? <MapPin size={15} /> : voice ? <Mic size={15} className={`list-mic ${last.played ? 'played' : own ? '' : 'new'}`} />
    : !last.body && last.file_type?.startsWith('image/') ? <Camera size={15} />
    : !last.body && last.file_type?.startsWith('video/') ? <Video size={15} /> : !last.body && last.file_type ? <FileText size={15} /> : null;
  const text = last.deleted ? (own ? 'Você apagou esta mensagem' : 'Mensagem apagada')
    : voice ? formatDuration(last.duration_ms!) : place ? last.body ?? placeLabel(place) : last.body ?? (last.file_type?.startsWith('image/') ? 'Foto' : last.file_type?.startsWith('video/') ? 'Vídeo' : last.file_name ?? 'Arquivo');
  return <span className={`chat-row-preview ${last.deleted ? 'deleted' : ''}`}>{tick}{own && group && !last.deleted ? 'Você: ' : who}{icon}<span>{text}</span></span>;
}

function ChatList({ userId, chats, groupLast, groupUnread, groupMentions, open, blocked, onOpen, onNew, onNewGroup, onPerson }: {
  userId: string | null; chats: Chat[] | null; groupLast: Last | null; groupUnread: number; groupMentions: number; open: string | null; blocked: string[];
  onOpen: (key: string) => void; onNew: () => void; onNewGroup: () => void; onPerson: (person: Person) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [menu, setMenu] = useState(false);
  const wide = useWide();
  const people = usePeople(userId, !!query.trim());
  // Tiques do geral: só importam quando a última mensagem é sua.
  const groupReceipts = useGeneralReceipts(!!userId && groupLast?.user_id === userId).receipts;
  const onlineUsers = useOnlineUsers();
  const term = normalize(query.trim());
  const sortedChats = [...(chats ?? [])].sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
  const showGroup = filter !== 'unread' || groupUnread > 0;
  const groupMatches = !term || normalize('Torcida Solar').includes(term);
  const visibleChats = sortedChats.filter(c => (filter !== 'unread' || c.unread > 0) && (filter !== 'groups' || !!c.group) && (!term || normalize(chatName(c)).includes(term)));
  const contacts = term ? (people ?? []).filter(p => normalize(p.name).includes(term) && !visibleChats.some(c => c.other?.id === p.id)) : [];

  return <>
    <header className="chats-header">
      <h1>Conversas</h1>
      <button className="icon-button" onClick={() => setMenu(true)} aria-label="Mais opções" aria-haspopup="menu"><EllipsisVertical size={22} /></button>
      <button className="new-chat-button only-desktop" onClick={onNew} aria-label="Nova conversa" title="Nova conversa"><MessageSquarePlus size={20} /></button>
    </header>
    {menu && <div className="menu-layer" onClick={() => setMenu(false)}>
      <div className="menu-list chats-menu" role="menu">
        <button role="menuitem" onClick={onNew}><span>Nova conversa</span></button>
        <button role="menuitem" onClick={onNewGroup}><span>Novo grupo</span></button>
        <button role="menuitem" onClick={() => onOpen(GROUP_KEY)}><span>Abrir o grupo geral</span></button>
      </div>
    </div>}
    <label className="chats-search">
      <Search size={18} />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder={wide ? 'Pesquisar ou começar uma nova conversa' : 'Pesquisar'} aria-label="Pesquisar conversas e pessoas" />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><X size={18} /></button>}
    </label>
    <div className="chats-filters" role="tablist">
      {([['all', 'Tudo'], ['unread', 'Não lidas'], ['groups', 'Grupos']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
    </div>

    <div className="chats-scroll">
      {showGroup && groupMatches && <button className={`chat-row ${open === GROUP_KEY ? 'active' : ''}`} onClick={() => onOpen(GROUP_KEY)}>
        <img src="/images/logo.png" alt="" className="chat-row-avatar" />
        <span className="chat-row-main">
          <span className="chat-row-top"><strong>Torcida Solar</strong>{groupLast && <time className={groupUnread ? 'unread' : ''}>{listTime(groupLast.created_at)}</time>}</span>
          <span className="chat-row-bottom">
            <LastPreview last={groupLast && !blocked.includes(groupLast.user_id) ? groupLast : null} userId={userId} group receipts={groupReceipts} />
            {groupMentions > 0 && <b className="chat-row-badge chat-row-mention" aria-label="Você foi mencionado">@</b>}
            {groupUnread > 0 && <b className="chat-row-badge">{groupUnread > 99 ? '99+' : groupUnread}</b>}
            <Pin size={16} className="chat-row-pin" aria-label="Fixada" />
          </span>
        </span>
      </button>}

      {visibleChats.map(c => <button key={c.id} className={`chat-row ${open === c.id ? 'active' : ''}`} onClick={() => onOpen(c.id)}>
        <span className="chat-row-avatar-wrap">
          {c.group ? <GroupAvatar id={c.id} group={c.group} /> : c.other && <Avatar id={c.other.id} name={c.other.name} url={c.other.avatar_url} />}
        </span>
        <span className="chat-row-main">
          <span className="chat-row-top"><strong>{chatName(c)}</strong>{c.last && <time className={c.unread ? 'unread' : ''}>{listTime(c.last.created_at)}</time>}</span>
          <span className="chat-row-bottom">
            <LastPreview last={c.last} userId={userId} group={!!c.group} receipts={{ read: c.otherRead, delivered: c.otherDelivered }} />
            {c.other && blocked.includes(c.other.id) && <Ban size={15} className="chat-row-pin" aria-label="Bloqueado" />}
            {c.mentions > 0 && <b className="chat-row-badge chat-row-mention" aria-label="Você foi mencionado">@</b>}
            {c.unread > 0 && <b className="chat-row-badge">{c.unread > 99 ? '99+' : c.unread}</b>}
          </span>
        </span>
      </button>)}

      {contacts.length > 0 && <>
        <p className="chats-label">Contatos no DSB</p>
        {contacts.slice(0, 30).map(person => <PersonRow key={person.id} person={person} online={onlineUsers.has(person.id)} onPick={onPerson} />)}
      </>}

      {!userId && <div className="chats-empty">
        <p>Entre para conversar em particular com qualquer pessoa que usa o app.</p>
      </div>}
      {userId && chats !== null && !visibleChats.length && !term && filter === 'all' && <div className="chats-empty">
        <p>Suas conversas particulares e grupos aparecem aqui. Toque em <MessageSquarePlus size={15} /> para começar uma.</p>
      </div>}
      {userId && chats !== null && !visibleChats.length && !term && filter === 'groups' && <div className="chats-empty">
        <p>Crie um grupo para conversar com a sua turma, a sua equipe ou quem quiser.</p>
      </div>}
      {filter === 'groups' && !term && <button className="chat-row person" onClick={onNewGroup}>
        <span className="chat-row-avatar-wrap"><span className="avatar new-group-icon"><Users size={22} /></span></span>
        <span className="chat-row-main"><span className="chat-row-top"><strong>Novo grupo</strong></span></span>
      </button>}
      {term && !groupMatches && !visibleChats.length && !contacts.length && people !== null && <p className="chats-empty">Nenhuma conversa ou pessoa encontrada.</p>}
      <p className="chats-footnote"><Lock size={12} /> Suas conversas particulares e grupos só aparecem para quem participa deles.</p>
    </div>
    <button className="new-chat-fab only-mobile" onClick={onNew} aria-label="Nova conversa"><MessageSquarePlus size={24} /></button>
  </>;
}

/** Todo mundo que já entrou no app (é a "agenda" do chat). Só carrega quando precisa. */
function usePeople(userId: string | null, enabled: boolean) {
  const [people, setPeople] = useState<{ user: string | null; list: Person[] } | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return;
    let alive = true;
    void supabase.from('profiles').select('id, name, avatar_url').neq('id', userId).is('banned_at', null).order('name').limit(1000)
      .then(({ data }) => { if (alive) setPeople({ user: userId, list: data ?? [] }); });
    return () => { alive = false; };
  }, [userId, enabled]);
  return people?.user === userId ? people.list : userId ? null : [];
}

function PersonRow({ person, online, onPick }: { person: Person; online: boolean; onPick: (person: Person) => void }) {
  return <button className="chat-row person" onClick={() => onPick(person)}>
    <span className="chat-row-avatar-wrap">
      <Avatar id={person.id} name={person.name} url={person.avatar_url} />
    </span>
    <span className="chat-row-main"><span className="chat-row-top"><strong>{person.name}</strong></span>
      <span className="chat-row-bottom"><span className="chat-row-preview">{online ? 'online' : 'Contato no DSB'}</span></span></span>
  </button>;
}

/** "Nova conversa": todas as pessoas que entraram no app, em ordem alfabética, com as letras separando. */
function NewChat({ userId, onClose, onPick, onGroup }: { userId: string | null; onClose: () => void; onPick: (person: Person) => void; onGroup: () => void }) {
  const [query, setQuery] = useState('');
  const people = usePeople(userId, true);
  const onlineUsers = useOnlineUsers();
  const term = normalize(query.trim());
  const list = (people ?? []).filter(p => !term || normalize(p.name).includes(term));
  const groups: { letter: string; list: Person[] }[] = [];
  for (const person of list) {
    const letter = normalize(person.name.trim()[0] ?? '#').toUpperCase().replace(/[^A-Z]/, '#');
    const last = groups[groups.length - 1];
    if (last?.letter === letter) last.list.push(person); else groups.push({ letter, list: [person] });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <>
    <header className="chats-header sub">
      <button className="icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={22} /></button>
      <h2>Nova conversa</h2>
    </header>
    <label className="chats-search">
      <Search size={18} />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar nome" aria-label="Pesquisar pessoas" autoFocus />
    </label>
    <div className="chats-scroll">
      {!term && <button className="chat-row person" onClick={onGroup}>
        <span className="chat-row-avatar-wrap"><span className="avatar new-group-icon"><Users size={22} /></span></span>
        <span className="chat-row-main"><span className="chat-row-top"><strong>Novo grupo</strong></span></span>
      </button>}
      <p className="chats-label">Contatos no DSB{people ? ` · ${people.length}` : ''}</p>
      {people === null ? <p className="chats-empty"><span className="spinner" /></p>
        : !list.length ? <p className="chats-empty">Ninguém encontrado com esse nome.</p>
        : groups.map(group => <div key={group.letter}>
          <p className="chats-letter">{group.letter}</p>
          {group.list.map(person => <PersonRow key={person.id} person={person} online={onlineUsers.has(person.id)} onPick={onPick} />)}
        </div>)}
    </div>
  </>;
}

/** Desktop sem conversa aberta: a tela de boas-vindas, como a do WhatsApp Web. */
function Intro({ onGroup }: { onGroup: () => void }) {
  const { userId, requireLogin } = useAuth();
  return <div className="chats-intro">
    <img src="/images/logo.png" alt="" />
    <h2>Conversas do DSB</h2>
    <p>Converse com a torcida no grupo geral, mande mensagem para qualquer pessoa que usa o app ou crie grupos com quem quiser. Tudo em tempo real, no celular e no computador.</p>
    <div>
      <button className="button primary" onClick={onGroup}>Abrir o grupo geral</button>
      {!userId && <button className="button" onClick={() => requireLogin('Entre para conversar em particular.')}><LogIn size={16} /> Entrar</button>}
    </div>
    <small><Lock size={12} /> Suas conversas particulares e grupos só aparecem para quem participa deles.</small>
  </div>;
}
