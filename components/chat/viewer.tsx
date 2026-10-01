'use client';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, MessageSquareText, Play, Reply as ReplyIcon, SmilePlus, X, ZoomIn, ZoomOut } from 'lucide-react';
import { whenLabel } from '@/lib/chat-format';
import { canSaveToGallery, isNativeApp, saveToGallery, shareNativeFile } from '@/lib/native-share';
import { registerOverlay } from '@/lib/overlays';
import { Avatar } from '../ui';
import { useFileUrl } from './files';
import { fetchMessages } from './group-info';
import { Formatted } from './message';
import { authorLabel, isVideo, REACTIONS, type Message } from './types';

type Zoom = { s: number; x: number; y: number };
type StageApi = { zoomBy: (delta: number) => void };
const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 4;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Visualizador de fotos e vídeos do WhatsApp: quem mandou e quando no topo, ações à direita,
 * setas para a mídia anterior e a próxima e a faixa de miniaturas da conversa embaixo.
 * Zoom com clique, botões, roda do mouse e pinça; arrastar move a imagem ampliada.
 * No celular: deslizar para os lados troca de mídia e puxar para baixo fecha.
 */
export function Viewer({ message, userId, blocked, myReaction, onClose, onJump, onReply, onReact }: {
  message: Message | null; userId: string | null; blocked: string[];
  myReaction: (id: number) => string | null; onClose: () => void;
  onJump: (message: Message) => void; onReply: (message: Message) => void; onReact: (message: Message, emoji: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const fechar = useRef(onClose);
  const [items, setItems] = useState<Message[] | null>(null);
  const [currentId, setCurrentId] = useState(message?.id ?? 0);
  const stageApi = useRef<StageApi>(null);
  const [scale, setScale] = useState(1);
  const [reacting, setReacting] = useState(false);
  const [saved, setSaved] = useState<number | string | null>(null);
  useEffect(() => { fechar.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!message) return;
    dialog?.showModal();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog?.close(); solta(); };
  }, [message]);

  // A galeria é a mídia da conversa inteira, em ordem, como a faixa do WhatsApp.
  useEffect(() => {
    if (!message) return;
    let alive = true;
    void fetchMessages('media', 200, message.conversation_id).then(list => {
      if (!alive) return;
      const ordered = list.reverse().filter(m => m.id === message.id || !blocked.includes(m.user_id));
      if (!ordered.some(m => m.id === message.id)) ordered.push(message);
      setItems(ordered.sort((a, b) => a.id - b.id));
    });
    return () => { alive = false; };
  }, [message, blocked]);

  const list = items ?? (message ? [message] : []);
  const index = Math.max(0, list.findIndex(m => m.id === currentId));
  const current = list[index] ?? message;

  function go(step: number) {
    const next = list[index + step];
    if (!next) return;
    setCurrentId(next.id);
    setScale(1);
    setReacting(false);
  }

  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [currentId, items]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') stageApi.current?.zoomBy(.5);
      else if (e.key === '-') stageApi.current?.zoomBy(-.5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const conversationId = current?.conversation_id ?? null;
  const download = useFileUrl(conversationId, current?.file_path ?? null, current?.file_name ?? 'arquivo') ?? undefined;
  const video = !!current && isVideo(current);
  const mine = current ? myReaction(current.id) : null;

  // No app o link não baixa: foto e vídeo vão direto para a galeria (como no WhatsApp) e o
  // ícone vira um ✓, porque o aviso geral do app fica por baixo desta janela.
  async function saveNative(url: string, item: Message) {
    const name = item.file_name ?? 'arquivo';
    try {
      if (canSaveToGallery()) await saveToGallery({ url, name }, isVideo(item) ? 'video' : 'photo');
      else await shareNativeFile({ url, name });
      setSaved(item.id);
    } catch (error) { console.warn('Não foi possível baixar:', error); }
  }

  return <dialog ref={ref} className="viewer" onCancel={e => { e.preventDefault(); onClose(); }} aria-label="Visualizar mídia">
    {current && <>
      <header className="viewer-bar">
        <button className="icon-button only-mobile" onClick={onClose} aria-label="Voltar"><ArrowLeft size={24} /></button>
        <Avatar id={current.user_id} name={current.author_name} url={current.author_avatar} />
        <div className="viewer-who"><strong>{authorLabel(current, userId)}</strong><small>{whenLabel(current.created_at)}</small></div>
        <div className="viewer-actions">
          {!video && <>
            <button className="icon-button only-desktop" disabled={scale <= 1} onClick={() => stageApi.current?.zoomBy(-.5)} aria-label="Diminuir zoom" title="Diminuir zoom"><ZoomOut size={22} /></button>
            <button className="icon-button only-desktop" disabled={scale >= MAX_ZOOM} onClick={() => stageApi.current?.zoomBy(.5)} aria-label="Aumentar zoom" title="Aumentar zoom"><ZoomIn size={22} /></button>
          </>}
          <button className="icon-button only-desktop" onClick={() => onJump(current)} aria-label="Ir para a mensagem" title="Ir para a mensagem"><MessageSquareText size={22} /></button>
          {userId && <button className="icon-button" onClick={() => onReply(current)} aria-label="Responder" title="Responder"><ReplyIcon size={22} /></button>}
          {userId && <span className="viewer-react">
            <button className="icon-button" onClick={() => setReacting(!reacting)} aria-label="Reagir" title="Reagir" aria-expanded={reacting}><SmilePlus size={22} /></button>
            {reacting && <div className="reaction-bar">
              {REACTIONS.map(emoji => <button key={emoji} className={emoji === mine ? 'mine' : ''} onClick={() => { setReacting(false); onReact(current, emoji); }} aria-label={`Reagir com ${emoji}`}>{emoji}</button>)}
            </div>}
          </span>}
          <a className="icon-button" href={download} aria-label={saved === current.id ? 'Salvo na galeria' : 'Baixar'} title="Baixar"
            onClick={e => { if (download && isNativeApp()) { e.preventDefault(); void saveNative(download, current); } }}>
            {saved === current.id ? <Check size={22} /> : <Download size={22} />}</a>
          <button className="icon-button only-desktop" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={24} /></button>
        </div>
      </header>

      <div className="viewer-stage-wrap">
        {index > 0 && <button className="viewer-nav prev only-desktop" onClick={() => go(-1)} aria-label="Anterior"><ChevronLeft size={22} /></button>}
        <Stage key={current.id} api={stageApi} message={current} onScale={setScale} onPrev={() => go(-1)} onNext={() => go(1)} onClose={onClose} />
        {index < list.length - 1 && <button className="viewer-nav next only-desktop" onClick={() => go(1)} aria-label="Próxima"><ChevronRight size={22} /></button>}
      </div>
      {current.body && <p className="viewer-caption"><Formatted text={current.body} /></p>}

      {list.length > 1 && <div className="viewer-strip only-desktop" ref={strip}>
        {list.map(m => <Thumb key={m.id} message={m} active={m.id === current.id} onPick={() => { setCurrentId(m.id); setScale(1); }} />)}
      </div>}
    </>}
  </dialog>;
}

function Thumb({ message, active, onPick }: { message: Message; active: boolean; onPick: () => void }) {
  const src = useFileUrl(message.conversation_id, message.thumb_path);
  return <button className="viewer-thumb" aria-current={active} onClick={onPick} aria-label={isVideo(message) ? 'Vídeo' : 'Foto'}>
    {src && <img src={src} alt="" loading="lazy" draggable={false} />}
    {isVideo(message) && <Play size={14} fill="currentColor" />}
  </button>;
}

/** A mídia em si, com zoom e gestos. */
function Stage({ api, message, onScale, onPrev, onNext, onClose }: {
  api: React.Ref<StageApi>; message: Message; onScale: (scale: number) => void;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const [zoom, setZoomState] = useState<Zoom>(NO_ZOOM);
  const setZoom = (next: Zoom) => { setZoomState(next); onScale(next.s); };
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; start: Zoom; dist: number; moved: boolean; pinch: boolean; lastTap: number }>({ startX: 0, startY: 0, start: NO_ZOOM, dist: 0, moved: false, pinch: false, lastTap: 0 });
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const full = useFileUrl(message.conversation_id, message.file_path);
  const thumb = useFileUrl(message.conversation_id, message.thumb_path);
  const video = isVideo(message);

  /** Aplica um zoom mantendo parado o ponto da tela em (px, py), e não deixa a imagem sair da área. */
  function zoomAt(next: number, px: number, py: number, from: Zoom = zoom) {
    const el = stage.current, img = image.current;
    if (!el || !img) return;
    const s = clamp(next, 1, MAX_ZOOM);
    if (s === 1) { setZoom(NO_ZOOM); return; }
    const box = el.getBoundingClientRect();
    const cx = px - (box.left + box.width / 2), cy = py - (box.top + box.height / 2);
    const x = cx - (s / from.s) * (cx - from.x), y = cy - (s / from.s) * (cy - from.y);
    setZoom(fit({ s, x, y }));
  }

  function fit(z: Zoom): Zoom {
    const el = stage.current, img = image.current;
    if (!el || !img) return z;
    const maxX = Math.max(0, (img.offsetWidth * z.s - el.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * z.s - el.clientHeight) / 2);
    return { s: z.s, x: clamp(z.x, -maxX, maxX), y: clamp(z.y, -maxY, maxY) };
  }

  // Botões e teclado do topo ampliam pelo centro da área.
  useImperativeHandle(api, () => ({
    zoomBy(delta: number) {
      const box = stage.current?.getBoundingClientRect();
      if (box) zoomAt(zoom.s + delta, box.left + box.width / 2, box.top + box.height / 2);
    },
  }));

  function onPointerDown(e: React.PointerEvent) {
    if (video) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já saiu */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      Object.assign(g, { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), start: zoom, moved: true });
      return;
    }
    Object.assign(g, { startX: e.clientX, startY: e.clientY, start: zoom, moved: false, pinch: false });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      zoomAt(g.start.s * Math.hypot(a.x - b.x, a.y - b.y) / g.dist, (a.x + b.x) / 2, (a.y + b.y) / 2, g.start);
      return;
    }
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) g.moved = true;
    if (!g.moved) return;
    // Ampliada: arrastar move a imagem. Sem zoom (toque): acompanha o dedo para trocar ou fechar.
    if (zoom.s > 1) setZoom(fit({ s: zoom.s, x: g.start.x + dx, y: g.start.y + dy }));
    else if (e.pointerType !== 'mouse') setDrag(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.pinch) { if (pointers.current.size === 0) g.pinch = false; return; }
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    setDrag({ x: 0, y: 0 });
    if (!g.moved) {
      // Mouse: clique amplia no ponto e clica de novo para voltar. Toque: toque duplo.
      const now = performance.now();
      const toggle = e.pointerType === 'mouse' || now - g.lastTap < 300;
      g.lastTap = e.pointerType === 'mouse' ? 0 : now;
      if (toggle) { if (zoom.s > 1) setZoom(NO_ZOOM); else zoomAt(2.5, e.clientX, e.clientY); }
      return;
    }
    if (zoom.s > 1 || e.pointerType === 'mouse') return;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) onNext(); else onPrev(); }
    else if (dy > 110) onClose();
  }

  function onWheel(e: React.WheelEvent) {
    if (video) return;
    zoomAt(zoom.s * Math.exp(-e.deltaY * .0015), e.clientX, e.clientY);
  }

  const style = zoom.s > 1
    ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }
    : drag.x || drag.y ? { transform: `translate(${drag.x}px, ${drag.y}px)`, opacity: 1 - Math.min(drag.y / 400, .5), transition: 'none' } : undefined;

  return <div ref={stage} className={`viewer-stage ${zoom.s > 1 ? 'zoomed' : ''}`}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
    {video
      ? <video src={full ?? undefined} controls autoPlay playsInline poster={thumb ?? undefined} />
      : <img ref={image} src={full ?? thumb ?? undefined} alt={message.file_name ?? ''} draggable={false} style={style} />}
  </div>;
}

export type Photo = { id: string; name: string; url: string; subtitle?: string };
/** Foto do Google vem em 96px; para a tela cheia pede a mesma foto em tamanho grande. */
const fullSize = (url: string) => /googleusercontent\.com\//.test(url) ? url.replace(/=s\d+(-c)?$/, '=s800$1') : url;

/**
 * Foto do grupo ou de uma pessoa em tela cheia, como ao tocar na foto nos dados do contato do WhatsApp.
 * Toque fora da foto, voltar ou Esc fecham.
 */
export function PhotoViewer({ photo, onClose }: { photo: Photo | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!photo) return;
    dialog?.showModal();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog?.close(); solta(); };
  }, [photo]);

  return <dialog ref={ref} className="viewer photo-viewer" aria-label={photo ? `Foto de ${photo.name}` : 'Foto'}
    onCancel={e => { e.preventDefault(); onClose(); }}
    // O Esc fecha só a foto, não o painel de dados que está atrás.
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    {photo && <>
      <header className="viewer-bar">
        <button className="icon-button only-mobile" onClick={onClose} aria-label="Voltar"><ArrowLeft size={24} /></button>
        <Avatar id={photo.id} name={photo.name} url={photo.url} />
        <div className="viewer-who"><strong>{photo.name}</strong>{photo.subtitle && <small>{photo.subtitle}</small>}</div>
        <div className="viewer-actions">
          <button className="icon-button only-desktop" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={24} /></button>
        </div>
      </header>
      <div className="viewer-stage-wrap photo-stage" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <img src={fullSize(photo.url)} alt={`Foto de ${photo.name}`} referrerPolicy="no-referrer" draggable={false} />
      </div>
    </>}
  </dialog>;
}
