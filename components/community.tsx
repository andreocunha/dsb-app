'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Ban, Download, FileText, Flag, Info, LogIn, Paperclip, Pin, Play, Send, Smile, Sun, Trash2, X } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { registerOverlay } from '@/lib/overlays';
import { shortName } from '@/lib/names';
import { supabase, chatFileUrl, errorMessage } from '@/lib/supabase';
import { formatSize, makeThumbnail, MAX_FILE_SIZE, storageName } from '@/lib/media';
import { useApp, useChatUnread, useOnline } from './app-shell';
import { useAuth } from './auth';
import { Avatar, Sheet } from './ui';

type Reaction = { user_id: string; emoji: string };
type Row = Database['public']['Tables']['messages']['Row'];
type Message = Row & { reactions: Reaction[] };
type Reactor = { user_id: string; name: string; avatar_url: string | null; emoji: string };

const PAGE = 50;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const QUICK_EMOJIS = ['☀️', '🚤', '💜', '👏', '🔥', '🏆', '💪', '🌊'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
const isVideo = (m: Row) => !!m.file_type?.startsWith('video/');
// Imagem precisa da miniatura; vídeo abre no player mesmo sem ela.
const isVisual = (m: Row) => isVideo(m) || (!!m.thumb_path && !!m.file_type?.startsWith('image/'));

async function fetchPage(before?: number) {
  const { data, error } = await supabase.rpc('chat_messages', { p_before: before, p_limit: PAGE });
  return error ? null : (data as unknown as Message[]).reverse();
}

export function Community() {
  const { userId, requireLogin } = useAuth();
  const { notify } = useApp();
  const { markRead } = useChatUnread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [reactorsOf, setReactorsOf] = useState<Message | null>(null);
  const [viewer, setViewer] = useState<Message | null>(null);
  const [info, setInfo] = useState(false);
  // Quando a pessoa está lendo mensagens antigas, as novas viram um contador no botão de descer.
  const [newCount, setNewCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const prependFrom = useRef<number | null>(null);

  const applyPage = useCallback((page: Message[] | null, before?: number) => {
    if (!page) { setStatus('error'); return; }
    if (before) prependFrom.current = list.current?.scrollHeight ?? null;
    setMessages(current => before ? [...page, ...current] : page);
    setHasMore(page.length === PAGE);
    setStatus('ready');
    if (!before && page.length) markRead(page[page.length - 1].id);
  }, [markRead]);
  const loadOlder = (before: number) => void fetchPage(before).then(page => applyPage(page, before));

  // Carga inicial + tempo real (mensagens e reações).
  useEffect(() => {
    void fetchPage().then(page => applyPage(page));
    const upsertReaction = (reaction: Reaction & { message_id: number }) => setMessages(current => current.map(m => m.id !== reaction.message_id ? m
      : { ...m, reactions: [...m.reactions.filter(r => r.user_id !== reaction.user_id), { user_id: reaction.user_id, emoji: reaction.emoji }] }));
    const channel = supabase.channel('chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        setMessages(current => current.some(m => m.id === row.id) ? current : [...current, { ...(row as Row), reactions: [] }]);
        if (stickToBottom.current) markRead(row.id); else setNewCount(count => count + 1);
      })
      // Ex.: a pessoa trocou o nome, e as mensagens antigas dela são atualizadas.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: row }) =>
        setMessages(current => current.map(m => m.id === row.id ? { ...m, ...(row as Row) } : m)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) =>
        setMessages(current => current.filter(m => m.id !== old.id)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, ({ new: row }) => upsertReaction(row as Reaction & { message_id: number }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old }) =>
        setMessages(current => current.map(m => m.id !== old.message_id ? m : { ...m, reactions: m.reactions.filter(r => r.user_id !== old.user_id) })))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [applyPage, markRead]);

  useEffect(() => {
    if (!userId) return;
    void supabase.from('user_blocks').select('blocked_id').then(({ data }) => setBlocked((data ?? []).map(b => b.blocked_id)));
  }, [userId]);

  // Mantém a conversa no fim quando chegam mensagens, e a posição ao carregar as antigas.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (prependFrom.current !== null) { el.scrollTop += el.scrollHeight - prependFrom.current; prependFrom.current = null; }
    else if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = list.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottom.current = bottom;
    if (bottom === atBottom) return;
    setAtBottom(bottom);
    if (bottom) goToBottom();
  }

  function goToBottom() {
    setNewCount(0);
    const lastId = messages[messages.length - 1]?.id;
    if (lastId) markRead(lastId);
  }

  function scrollToBottom() {
    stickToBottom.current = true;
    // Salto direto: rolagem suave fica pendurada quando a aba está em segundo plano.
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    setAtBottom(true);
    goToBottom();
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) { requireLogin('Entre para conversar com a torcida.'); return; }
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    const uploaded: string[] = [];
    try {
      const args: Database['public']['Functions']['send_message']['Args'] = { p_body: body || undefined };
      if (file) {
        if (file.size > MAX_FILE_SIZE) throw new Error('Arquivos podem ter até 50MB.');
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
      stickToBottom.current = true;
      setNewCount(0);
      setMessages(current => current.some(m => m.id === data.id) ? current : [...current, { ...data, reactions: [] }]);
      setText(''); setFile(null); setEmojis(false);
      input.current?.focus();
    } catch (error) {
      if (uploaded.length) void supabase.storage.from('chat').remove(uploaded);
      notify(errorMessage(error));
    } finally { setSending(false); }
  }

  async function react(message: Message, emoji: string) {
    setActive(null);
    if (!userId) { requireLogin('Entre para reagir às mensagens.'); return; }
    const mine = message.reactions.find(r => r.user_id === userId);
    const next = mine?.emoji === emoji ? null : emoji;
    setMessages(current => current.map(m => m.id !== message.id ? m : {
      ...m, reactions: [...m.reactions.filter(r => r.user_id !== userId), ...(next ? [{ user_id: userId, emoji: next }] : [])],
    }));
    const { error } = await supabase.rpc('react_to_message', { p_message_id: message.id, p_emoji: next });
    if (error) notify(errorMessage(error));
  }

  async function remove(message: Message) {
    setActive(null);
    const { data, error } = await supabase.rpc('delete_message', { p_id: message.id });
    if (error) { notify(errorMessage(error)); return; }
    setMessages(current => current.map(m => m.id !== message.id ? m
      : { ...m, deleted_at: new Date().toISOString(), body: null, file_path: null, thumb_path: null, file_name: null, file_type: null, reactions: [] }));
    if (data?.length) void supabase.storage.from('chat').remove(data);
  }

  async function report(message: Message) {
    setActive(null);
    const { error } = await supabase.rpc('report_message', { p_message_id: message.id });
    notify(error ? errorMessage(error) : 'Denúncia enviada. Obrigado por ajudar a manter o chat saudável.');
  }

  async function block(message: Message) {
    setActive(null);
    const { error } = await supabase.from('user_blocks').insert({ blocked_id: message.user_id });
    if (error && error.code !== '23505') { notify(errorMessage(error)); return; }
    setBlocked(current => [...current, message.user_id]);
    notify(`Você não verá mais mensagens de ${message.author_name}.`);
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    if (chosen.size > MAX_FILE_SIZE) { notify('Arquivos podem ter até 50MB.'); return; }
    setFile(chosen);
  }

  const visible = messages.filter(m => !blocked.includes(m.user_id));

  return <section className="chat fill" aria-label="Chat da comunidade">
    <header className="chat-header">
      <span className="chat-icon"><Sun size={20} /></span>
      <div><h1>Torcida Solar</h1><OnlineCount /></div>
      <button className="icon-button" aria-label="Regras do chat" onClick={() => setInfo(true)}><Info size={20} /></button>
    </header>
    <button className="chat-pinned" onClick={() => setInfo(true)}><Pin size={14} /><span><b>Fixada:</b> Respeito é a nossa principal regra. Boa torcida!</span></button>

    <div className="chat-messages" ref={list} onScroll={onScroll} role="log" aria-label="Mensagens da comunidade" aria-live="polite"
      onClick={e => { if (!(e.target as HTMLElement).closest('.bubble, .message-actions')) setActive(null); }}>
      {hasMore && <button className="chat-more" onClick={() => loadOlder(messages[0].id)}>Carregar mensagens anteriores</button>}
      {status === 'loading' && <p className="chat-notice">Carregando conversa…</p>}
      {status === 'error' && <p className="chat-notice">Não foi possível carregar o chat. Verifique sua conexão.</p>}
      {status === 'ready' && visible.length === 0 && <p className="chat-notice">Ninguém falou nada ainda. Puxe o assunto! ☀️</p>}
      {visible.map((message, index) => {
        const own = message.user_id === userId;
        const previous = visible[index - 1];
        const newDay = !previous || day(previous.created_at) !== day(message.created_at);
        const grouped = !newDay && previous?.user_id === message.user_id;
        return <div key={message.id}>
          {newDay && <p className="chat-day">{day(message.created_at)}</p>}
          <div className={`message ${own ? 'own' : ''} ${grouped ? 'grouped' : ''}`}>
            {!own && (grouped ? <span className="avatar-space" /> : <Avatar id={message.user_id} name={message.author_name} url={message.author_avatar} small />)}
            <div className="message-body">
              {active === message.id && <div className="message-actions" role="menu">
                {REACTIONS.map(emoji => <button key={emoji} className="reaction-option" onClick={() => void react(message, emoji)} aria-label={`Reagir com ${emoji}`}>{emoji}</button>)}
                <span className="actions-divider" />
                {own
                  ? <button className="icon-button" onClick={() => void remove(message)} aria-label="Apagar mensagem"><Trash2 size={16} /></button>
                  : <>
                    <button className="icon-button" onClick={() => void report(message)} aria-label="Denunciar mensagem"><Flag size={16} /></button>
                    <button className="icon-button" onClick={() => void block(message)} aria-label={`Bloquear ${message.author_name}`}><Ban size={16} /></button>
                  </>}
              </div>}
              <div className={`bubble ${message.deleted_at ? 'deleted' : ''}`} role={message.deleted_at ? undefined : 'button'} tabIndex={message.deleted_at ? undefined : 0} aria-label={message.deleted_at ? undefined : 'Ações da mensagem'}
                onClick={() => { if (!message.deleted_at) setActive(active === message.id ? null : message.id); }}
                onKeyDown={e => { if (!message.deleted_at && e.key === 'Enter' && e.target === e.currentTarget) setActive(active === message.id ? null : message.id); }}>
                {!own && !grouped && <b className="bubble-author">{shortName(message.author_name)}</b>}
                {message.deleted_at
                  ? <p className="deleted-text"><Ban size={14} /> {own ? 'Você apagou esta mensagem' : 'Esta mensagem foi apagada'}</p>
                  : <>
                    {message.file_path && <Attachment message={message} onOpen={() => setViewer(message)} />}
                    {message.body && <p>{message.body}</p>}
                  </>}
                <span className="bubble-time">{time(message.created_at)}</span>
              </div>
              {message.reactions.length > 0 && <button className="reactions" onClick={() => setReactorsOf(message)} aria-label="Ver quem reagiu">
                {[...new Set(message.reactions.map(r => r.emoji))].slice(0, 3).join('')}
                {message.reactions.length > 1 && <span>{message.reactions.length}</span>}
              </button>}
            </div>
          </div>
        </div>;
      })}
    </div>

    {!atBottom && <button className="scroll-down" onClick={scrollToBottom} aria-label={newCount > 0 ? `${newCount} novas mensagens. Ir para o fim` : 'Ir para o fim da conversa'}>
      <ArrowDown size={20} />
      {newCount > 0 && <span className="badge">{newCount > 99 ? '99+' : newCount}</span>}
    </button>}

    {userId ? <form className="chat-compose" onSubmit={send}>
      {emojis && <div className="emoji-picker">{QUICK_EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => { setText(t => t + emoji); input.current?.focus(); }}>{emoji}</button>)}</div>}
      {file && <div className="compose-file"><FileText size={16} /><span>{file.name}</span><small>{formatSize(file.size)}</small><button type="button" className="icon-button" aria-label="Remover anexo" onClick={() => setFile(null)}><X size={16} /></button></div>}
      <button type="button" className="icon-button" aria-label={emojis ? 'Fechar emojis' : 'Escolher emoji'} onClick={() => setEmojis(!emojis)}>{emojis ? <X size={20} /> : <Smile size={20} />}</button>
      <button type="button" className="icon-button" aria-label="Anexar arquivo" onClick={() => picker.current?.click()}><Paperclip size={20} /></button>
      <input ref={picker} type="file" hidden onChange={pickFile} />
      <input ref={input} value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder={file ? 'Legenda (opcional)…' : 'Mensagem…'} aria-label="Sua mensagem" />
      <button type="submit" className="send-button" disabled={sending || (!text.trim() && !file)} aria-label="Enviar mensagem">{sending ? <span className="spinner" /> : <Send size={18} />}</button>
    </form> : <div className="chat-login">
      <p>Entre para mandar mensagens, fotos e reagir.</p>
      <button className="button primary" onClick={() => requireLogin('Entre para conversar com a torcida.')}><LogIn size={16} /> Entrar</button>
    </div>}

    <Reactors message={reactorsOf} userId={userId} onClose={() => setReactorsOf(null)} onRemove={message => { setReactorsOf(null); void react(message, message.reactions.find(r => r.user_id === userId)!.emoji); }} />
    <Viewer message={viewer} onClose={() => setViewer(null)} />
    <Sheet open={info} onClose={() => setInfo(false)} title="Bem-vindo à Torcida Solar">
      <div className="prose">
        <p>Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
        <ul>
          <li>Respeite as pessoas e todas as equipes.</li>
          <li>Mantenha a conversa relacionada ao evento.</li>
          <li>Evite spam e a divulgação de informações pessoais.</li>
          <li>Toque em uma mensagem para reagir, denunciar ou bloquear quem estiver incomodando.</li>
        </ul>
        <p className="footnote">Mensagens denunciadas são revisadas pela organização e podem ser removidas.</p>
      </div>
    </Sheet>
  </section>;
}

function OnlineCount() {
  const online = useOnline();
  return <p><span className="dot" /> {online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} no app agora` : 'Comunidade DSB'}</p>;
}

/** Imagem e vídeo aparecem pela miniatura leve; o original só carrega ao tocar. */
function Attachment({ message, onOpen }: { message: Message; onOpen: () => void }) {
  if (isVisual(message)) {
    const ratio = message.width && message.height ? `${message.width} / ${message.height}` : isVideo(message) ? '16 / 9' : '4 / 3';
    return <button type="button" className="media-preview" style={{ aspectRatio: ratio }} onClick={e => { e.stopPropagation(); onOpen(); }} aria-label={`Abrir ${message.file_name}`}>
      {message.thumb_path && <img src={chatFileUrl(message.thumb_path)} alt="" loading="lazy" />}
      {isVideo(message) && <span className="media-play"><Play size={22} fill="currentColor" /></span>}
    </button>;
  }
  return <a className="file-card" href={`${chatFileUrl(message.file_path!)}?download=${encodeURIComponent(message.file_name ?? '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
    <FileText size={22} />
    <span><strong>{message.file_name}</strong><small>{formatSize(message.file_size)}</small></span>
    <Download size={18} />
  </a>;
}

function Viewer({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!message) return;
    dialog?.showModal();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog?.close(); solta(); };
  }, [message]);
  const url = message?.file_path ? chatFileUrl(message.file_path) : '';
  return <dialog ref={ref} className="viewer" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label="Visualizar mídia">
    {message && <>
      <div className="viewer-bar">
        <span>{message.file_name}</span>
        <a className="icon-button" href={`${url}?download=${encodeURIComponent(message.file_name ?? '')}`} aria-label="Baixar"><Download size={18} /></a>
        <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
      </div>
      {message.file_type?.startsWith('video/')
        ? <video src={url} controls autoPlay playsInline poster={message.thumb_path ? chatFileUrl(message.thumb_path) : undefined} />
        : <img src={url} alt={message.file_name ?? ''} />}
    </>}
  </dialog>;
}

function Reactors({ message, userId, onClose, onRemove }: { message: Message | null; userId: string | null; onClose: () => void; onRemove: (message: Message) => void }) {
  const [reactors, setReactors] = useState<{ id: number; list: Reactor[] } | null>(null);
  const messageId = message?.id;
  const reactionCount = message?.reactions.length;
  useEffect(() => {
    if (!messageId) return;
    void supabase.rpc('message_reactors', { p_message_id: messageId }).then(({ data }) => setReactors({ id: messageId, list: (data as Reactor[] | null) ?? [] }));
  }, [messageId, reactionCount]);
  const list = reactors && reactors.id === messageId ? reactors.list : null;
  return <Sheet open={!!message} onClose={onClose} title="Reações">
    {!list ? <p className="panel-note">Carregando…</p> : <ul className="reactors">
      {list.map(r => <li key={r.user_id}>
        <Avatar id={r.user_id} name={r.name} url={r.avatar_url} small />
        <span>{r.user_id === userId ? <>Você<button className="text-button" onClick={() => onRemove(message!)}>Toque para remover</button></> : shortName(r.name)}</span>
        <b>{r.emoji}</b>
      </li>)}
    </ul>}
  </Sheet>;
}
