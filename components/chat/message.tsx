'use client';
import { useRef, useState } from 'react';
import { Ban, Camera, Check, ChevronDown, Clock3, Download, FileText, Play, Reply as ReplyIcon, SmilePlus, Video } from 'lucide-react';
import { formatMessage, jumboEmoji, nameColor, preview, type Token } from '@/lib/chat-format';
import { formatSize } from '@/lib/media';
import { shortName } from '@/lib/names';
import { chatFileUrl } from '@/lib/supabase';
import { Avatar } from '../ui';
import { authorLabel, isImage, isVideo, isVisual, replySnippet, time, type Message, type Reply } from './types';

export type MenuMode = 'full' | 'menu' | 'reactions';
export type MenuRequest = { message: Message; first: boolean; mode: MenuMode; rect: DOMRect; point?: { x: number; y: number } };

const SWIPE_REPLY = 64;
const LONG_PRESS = 450;
export const nameStyle = (id: string, userId: string | null) =>
  ({ '--q': id === userId ? 'var(--wa-green)' : `var(--wa-name-${nameColor(id)})` }) as React.CSSProperties;

/** Uma linha da conversa: avatar, balão, reações e os gestos (segurar abre o menu, arrastar responde). */
export function MessageRow({ message, first, userId, reply, flash, onMenu, onReply, onOpen, onJump, onReactors }: {
  message: Message; first: boolean; userId: string | null; reply: Reply | null; flash: boolean;
  onMenu: (request: MenuRequest) => void; onReply: (message: Message) => void; onOpen: (message: Message) => void;
  onJump: (id: number) => void; onReactors: (message: Message) => void;
}) {
  const own = message.user_id === userId;
  const bubble = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const swipeIcon = useRef<HTMLSpanElement>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout>; swiping: boolean; dx: number } | null>(null);
  const pointerType = useRef('mouse');
  const interactive = !message.deleted_at && !message.pending;

  function openMenu(mode: MenuMode, point?: { x: number; y: number }) {
    if (!bubble.current) return;
    onMenu({ message, first, mode, rect: bubble.current.getBoundingClientRect(), point });
  }

  function moveTo(dx: number, animate: boolean) {
    for (const el of [main.current, swipeIcon.current]) if (el) el.style.transition = animate ? 'transform .2s, opacity .2s' : '';
    if (main.current) main.current.style.transform = dx ? `translateX(${dx}px)` : '';
    if (swipeIcon.current) { swipeIcon.current.style.opacity = String(Math.min(dx / SWIPE_REPLY, 1)); swipeIcon.current.style.transform = `scale(${dx >= SWIPE_REPLY ? 1 : .7})`; }
  }

  function onPointerDown(e: React.PointerEvent) {
    pointerType.current = e.pointerType;
    if (e.pointerType === 'mouse' || !interactive) return;
    const timer = setTimeout(() => {
      press.current = null;
      navigator.vibrate?.(12);
      openMenu('full');
    }, LONG_PRESS);
    press.current = { x: e.clientX, y: e.clientY, timer, swiping: false, dx: 0 };
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.swiping) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(p.timer);
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { press.current = null; return; }
      if (dx > 12 && dx > Math.abs(dy) * 1.5) {
        p.swiping = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* o ponteiro já saiu: o arraste segue sem captura */ }
      }
    }
    if (!p.swiping) return;
    const next = Math.max(0, Math.min(dx, 96));
    if (next >= SWIPE_REPLY && p.dx < SWIPE_REPLY) navigator.vibrate?.(8);
    p.dx = next;
    moveTo(next, false);
  }

  function onPointerEnd(e: React.PointerEvent) {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.swiping) return;
    moveTo(0, true);
    if (e.type === 'pointerup' && p.dx >= SWIPE_REPLY) onReply(message);
  }

  function onContextMenu(e: React.MouseEvent) {
    // No toque, quem abre o menu é o toque longo acima; o menu nativo do sistema fica de fora.
    e.preventDefault();
    if (pointerType.current === 'mouse' && interactive) openMenu('menu', { x: e.clientX, y: e.clientY });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!interactive || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === 'ContextMenu') { e.preventDefault(); const r = bubble.current!.getBoundingClientRect(); openMenu('menu', { x: own ? r.right : r.left, y: r.bottom }); }
  }

  const emojis = [...new Set(message.reactions.map(r => r.emoji))].slice(0, 3);
  return <div id={`m-${message.id}`} className={`msg ${own ? 'own' : 'in'} ${first ? 'first' : ''} ${flash ? 'flash' : ''} ${message.reactions.length ? 'reacted' : ''}`}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
    {interactive && <span className="msg-swipe" ref={swipeIcon} aria-hidden><ReplyIcon size={18} /></span>}
    {!own && (first ? <Avatar id={message.user_id} name={message.author_name} url={message.author_avatar} small /> : <span className="avatar-space" />)}
    <div className="msg-main" ref={main}>
      <Bubble ref={bubble} message={message} first={first} userId={userId} reply={reply} onJump={onJump} onOpen={onOpen}
        onContextMenu={onContextMenu} onKeyDown={onKeyDown}
        onChevron={interactive ? e => { const r = e.currentTarget.getBoundingClientRect(); openMenu('menu', { x: own ? r.right : r.left, y: r.bottom }); } : undefined} />
      {emojis.length > 0 && <button className="reactions" onClick={() => onReactors(message)} aria-label={`${message.reactions.length} ${message.reactions.length === 1 ? 'reação' : 'reações'}. Ver quem reagiu`}>
        {emojis.join('')}
        {message.reactions.length > 1 && <span>{message.reactions.length}</span>}
      </button>}
    </div>
    {interactive && <button type="button" className="msg-react" tabIndex={-1} aria-label="Reagir"
      onClick={e => { const r = e.currentTarget.getBoundingClientRect(); openMenu('reactions', { x: r.left + r.width / 2, y: r.top }); }}>
      <SmilePlus size={18} />
    </button>}
  </div>;
}

/** O balão em si. Também é desenhado de novo, por cima do fundo escurecido, quando o menu de toque longo abre. */
export function Bubble({ ref, message, first, userId, reply, onJump, onOpen, onChevron, onContextMenu, onKeyDown }: {
  ref?: React.Ref<HTMLDivElement>; message: Message; first: boolean; userId: string | null; reply: Reply | null;
  onJump?: (id: number) => void; onOpen?: (message: Message) => void; onChevron?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void; onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const own = message.user_id === userId;
  const deleted = !!message.deleted_at;
  const file = !deleted && !!message.file_path;
  const visual = file && isVisual(message);
  const jumbo = !deleted && !file && !reply ? jumboEmoji(message.body) : 0;
  const kind = jumbo ? `jumbo jumbo-${jumbo}` : visual ? (message.body ? 'media' : 'media media-only') : file ? (message.body ? 'doc' : 'doc doc-only') : '';
  const short = !expanded && message.body ? preview(message.body) : null;
  const meta = <>
    {message.edited_at && !deleted && <span className="meta-edited">Editada</span>}
    <span>{time(message.created_at)}</span>
    {own && !deleted && (message.pending ? <Clock3 size={12} aria-label="Enviando" /> : <Check size={15} aria-label="Enviada" />)}
  </>;

  return <div ref={ref} className={`bubble ${kind} ${deleted ? 'deleted' : ''}`} tabIndex={onKeyDown && !deleted ? 0 : undefined}
    aria-label={onKeyDown && !deleted ? `Mensagem de ${own ? 'você' : shortName(message.author_name)}. Enter abre as ações` : undefined}
    onContextMenu={onContextMenu} onKeyDown={onKeyDown}>
    {first && !jumbo && <Tail />}
    {!own && first && !jumbo && <b className="bubble-author" style={nameStyle(message.user_id, userId)}>{shortName(message.author_name)}</b>}
    {reply && !deleted && <Quote reply={reply} userId={userId} onClick={onJump ? () => onJump(reply.id) : undefined} />}
    {file && <Attachment message={message} onOpen={onOpen} />}
    {deleted
      ? <p className="bubble-text deleted-text"><Ban size={15} /><i>{message.deleted_by && message.deleted_by !== message.user_id
          ? 'Mensagem removida pela organização'
          : own ? 'Você apagou esta mensagem' : 'Esta mensagem foi apagada'}</i><span className="meta-spacer" aria-hidden>{meta}</span></p>
      : message.body && <p className="bubble-text">
        {jumbo ? message.body : <Formatted text={short ?? message.body} />}
        {short && <button type="button" className="read-more" onClick={() => setExpanded(true)}>Ler mais</button>}
        <span className="meta-spacer" aria-hidden>{meta}</span>
      </p>}
    <span className="bubble-meta">{meta}</span>
    {onChevron && <button type="button" className="bubble-chevron" tabIndex={-1} aria-label="Mais opções" onClick={onChevron}><ChevronDown size={20} /></button>}
  </div>;
}

/** "Rabinho" do primeiro balão de cada sequência, no canto de cima. */
function Tail() {
  return <svg className="bubble-tail" viewBox="0 0 8 13" width="8" height="13" aria-hidden><path d="M1.53 0H8v11.2L.84 2.66C.14 1.83.46 0 1.53 0z" /></svg>;
}

/** plain: sem links clicáveis (a citação inteira já é um botão). */
export function Formatted({ text, plain = false }: { text: string; plain?: boolean }) {
  return <Tokens tokens={formatMessage(text)} plain={plain} />;
}

function Tokens({ tokens, plain }: { tokens: Token[]; plain: boolean }) {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'text': return token.text;
      case 'link': return plain ? token.text : <a key={i} className="bubble-link" href={token.href} target="_blank" rel="noopener noreferrer nofollow" onClick={e => e.stopPropagation()}>{token.text}</a>;
      case 'code': return <code key={i}>{token.text}</code>;
      case 'mono': return <code key={i} className="mono">{token.text}</code>;
      case 'bold': return <strong key={i}><Tokens tokens={token.children} plain={plain} /></strong>;
      case 'italic': return <em key={i}><Tokens tokens={token.children} plain={plain} /></em>;
      case 'strike': return <s key={i}><Tokens tokens={token.children} plain={plain} /></s>;
    }
  });
}

/** Citação: dentro do balão (toque leva até a original) e acima do campo de digitar. */
export function Quote({ reply, userId, onClick, label }: { reply: Reply; userId: string | null; onClick?: () => void; label?: string }) {
  const thumb = !reply.deleted && reply.thumb_path ? chatFileUrl(reply.thumb_path) : null;
  const icon = reply.deleted ? <Ban size={14} /> : !reply.body && isImage(reply) ? <Camera size={14} /> : !reply.body && isVideo(reply) ? <Video size={14} /> : !reply.body && reply.file_type ? <FileText size={14} /> : null;
  const content = <>
    <span className="quote-text">
      <b>{label ?? authorLabel(reply, userId)}</b>
      <span className="quote-body">{icon}<span>{reply.body && !reply.deleted ? <Formatted text={reply.body} plain /> : replySnippet(reply)}</span></span>
    </span>
    {thumb && <img src={thumb} alt="" loading="lazy" />}
  </>;
  return onClick
    ? <button type="button" className="quote" style={nameStyle(reply.user_id, userId)} onClick={e => { e.stopPropagation(); onClick(); }} aria-label={`Ir para a mensagem citada de ${authorLabel(reply, userId)}`}>{content}</button>
    : <div className="quote" style={nameStyle(reply.user_id, userId)}>{content}</div>;
}

const extension = (name: string | null) => (name?.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'arq').toUpperCase();

/** Imagem e vídeo aparecem pela miniatura leve; o original só carrega ao tocar. Documento vira o cartão do WhatsApp. */
function Attachment({ message, onOpen }: { message: Message; onOpen?: (message: Message) => void }) {
  if (isVisual(message)) {
    const ratio = message.width && message.height ? Math.min(Math.max(message.width / message.height, .5), 2) : isVideo(message) ? 16 / 9 : 4 / 3;
    const src = message.localUrl && isImage(message) ? message.localUrl : message.thumb_path ? chatFileUrl(message.thumb_path) : null;
    return <button type="button" className="bubble-media" style={{ aspectRatio: ratio }} disabled={message.pending || !onOpen}
      onClick={e => { e.stopPropagation(); onOpen?.(message); }} aria-label={`Abrir ${isVideo(message) ? 'vídeo' : 'foto'}`}>
      {src && <img src={src} alt="" loading="lazy" draggable={false} />}
      {message.pending ? <span className="media-round"><span className="spinner" /></span>
        : isVideo(message) && <span className="media-round"><Play size={22} fill="currentColor" /></span>}
    </button>;
  }
  const ext = extension(message.file_name);
  const content = <>
    <span className={`doc-icon doc-${ext.toLowerCase()}`}>{ext.slice(0, 4)}</span>
    <span className="doc-info"><strong>{message.file_name}</strong><small>{ext} · {formatSize(message.file_size)}</small></span>
    <span className="doc-download">{message.pending ? <span className="spinner" /> : <Download size={18} />}</span>
  </>;
  if (message.pending || !message.file_path) return <div className="doc-card">{content}</div>;
  return <a className="doc-card" href={`${chatFileUrl(message.file_path)}?download=${encodeURIComponent(message.file_name ?? '')}`} target="_blank" rel="noopener noreferrer"
    onClick={e => e.stopPropagation()} aria-label={`Baixar ${message.file_name}`}>{content}</a>;
}
