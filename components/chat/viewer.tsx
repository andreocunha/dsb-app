'use client';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, MessageSquareText, Play, Reply as ReplyIcon, SmilePlus, X, ZoomIn, ZoomOut } from 'lucide-react';
import { whenLabel } from '@/lib/chat-format';
import { canSaveToGallery, isNativeApp, saveToGallery, shareNativeFile } from '@/lib/native-share';
import { googleSize, proxiedImage } from '@/lib/images';
import { registerOverlay } from '@/lib/overlays';
import { Avatar } from '../ui';
import { useFileUrl } from './files';
import { fetchMessages } from './group-info';
import { Formatted } from './message';
import { authorLabel, isVideo, REACTIONS, type Message } from './types';

type StageApi = { zoomBy: (delta: number) => void };
const MAX_ZOOM = 4;

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

/** Área da foto: cabe inteira na tela, sem ampliar além do tamanho original. */
function fitSize(box: { w: number; h: number }, ratio: number, maxW: number) {
  const w = Math.min(box.w, box.h * ratio, maxW);
  return { w: Math.round(w), h: Math.round(w / ratio) };
}

/**
 * A mídia em si. A foto abre pela miniatura (já em cache do chat) e troca pelo original quando ele chega.
 * Zoom pelo react-zoom-pan-pinch (pinça, roda, arrastar ampliada); clique (mouse) ou toque duplo alterna o zoom.
 * Sem zoom, no toque: deslizar para os lados troca de mídia e puxar para baixo fecha.
 */
function Stage({ api, message, onScale, onPrev, onNext, onClose }: {
  api: React.Ref<StageApi>; message: Message; onScale: (scale: number) => void;
  onPrev: () => void; onNext: () => void; onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const zoom = useRef<ReactZoomPanPinchRef>(null);
  const scale = useRef(1);
  const pointers = useRef(new Set<number>());
  const gesture = useRef({ x: 0, y: 0, moved: false, multi: false, lastTap: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Proporção e tamanho original: do banco quando há, senão de quem carregar primeiro (miniatura ou original).
  const [measured, setMeasured] = useState<{ ratio: number; maxW: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const full = useFileUrl(message.conversation_id, message.file_path);
  const thumb = useFileUrl(message.conversation_id, message.thumb_path);
  const video = isVideo(message);
  const known = message.width && message.height ? { ratio: message.width / message.height, maxW: message.width } : null;
  const shape = known ?? measured;
  const size = box && shape ? fitSize(box, shape.ratio, shape.maxW) : null;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A área da foto mudou (girou a tela, chegou o tamanho): volta ao centro, sem zoom.
  useEffect(() => { if (size) zoom.current?.centerView(1, 0); }, [size?.w, size?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(api, () => ({
    zoomBy(delta: number) {
      if (delta > 0) zoom.current?.zoomIn(delta); else zoom.current?.zoomOut(-delta);
    },
  }));

  function onTransform(_: unknown, state: { scale: number }) {
    const before = scale.current;
    scale.current = state.scale;
    // O topo só precisa saber quando cruza 1x ou o máximo (para habilitar os botões), não a cada quadro.
    if ((before > 1.01) !== (state.scale > 1.01) || (before >= MAX_ZOOM) !== (state.scale >= MAX_ZOOM)) {
      setZoomed(state.scale > 1.01);
      onScale(state.scale);
    }
  }

  function toggleZoom(x: number, y: number) {
    const z = zoom.current;
    if (!z) return;
    if (scale.current > 1.01) void z.resetTransform(200);
    else void z.zoomToPoint(2.5, x, y, 200);
  }

  function onPointerDown(e: React.PointerEvent) {
    pointers.current.add(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 1) { g.multi = true; setDrag({ x: 0, y: 0 }); return; }
    Object.assign(g, { x: e.clientX, y: e.clientY, moved: false, multi: false });
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId) || g.multi) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
    // Ampliada, quem move a foto é a biblioteca. Sem zoom (toque): acompanha o dedo para trocar ou fechar.
    if (!g.moved || scale.current > 1.01 || e.pointerType === 'mouse') return;
    setDrag(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.multi) { if (pointers.current.size === 0) g.multi = false; return; }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    setDrag({ x: 0, y: 0 });
    if (e.type === 'pointercancel') return;
    if (!g.moved) {
      if (video) return;
      // Mouse: clique amplia no ponto e clica de novo para voltar. Toque: toque duplo.
      const now = performance.now();
      const toggle = e.pointerType === 'mouse' || now - g.lastTap < 300;
      g.lastTap = toggle ? 0 : now;
      if (toggle) toggleZoom(e.clientX, e.clientY);
      return;
    }
    if (scale.current > 1.01 || e.pointerType === 'mouse') return;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) onNext(); else onPrev(); }
    else if (dy > 110) onClose();
  }

  const measure = (img: HTMLImageElement, original: boolean) => {
    if (known || !img.naturalWidth || !img.naturalHeight) return;
    // A miniatura dá só a proporção; o tamanho original vem do arquivo completo.
    setMeasured(current => original || !current ? { ratio: img.naturalWidth / img.naturalHeight, maxW: original ? img.naturalWidth : Infinity } : current);
  };
  const swipe = drag.x || drag.y ? { transform: `translate(${drag.x}px, ${drag.y}px)`, opacity: 1 - Math.min(drag.y / 400, .5), transition: 'none' } : undefined;

  return <div ref={stage} className={`viewer-stage ${zoomed ? 'zoomed' : ''}`}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <div className="viewer-swipe" style={swipe}>
      {video
        ? <video src={full ?? undefined} controls autoPlay playsInline poster={thumb ?? undefined} />
        : <TransformWrapper ref={zoom} minScale={1} maxScale={MAX_ZOOM} centerOnInit centerZoomedOut limitToBounds
            doubleClick={{ disabled: true }} panning={{ disabled: !zoomed }} onTransform={onTransform}>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
            <div className="viewer-photo" style={size ? { width: size.w, height: size.h } : { width: 0, height: 0 }}>
              {thumb && !loaded && <img src={thumb} alt="" draggable={false} onLoad={e => measure(e.currentTarget, false)} />}
              {full && <img src={full} alt={message.file_name ?? ''} draggable={false}
                onLoad={e => { measure(e.currentTarget, true); setLoaded(true); }} />}
            </div>
          </TransformComponent>
        </TransformWrapper>}
    </div>
    {!video && !loaded && <span className="viewer-loading"><span className="spinner" /></span>}
  </div>;
}

export type Photo = { id: string; name: string; url: string; subtitle?: string };
/** Tela cheia: a foto do Google em tamanho grande, reduzida e em cache pelo wsrv. */
const fullSize = (url: string) => proxiedImage(googleSize(url, 1080), 1080, 'inside');

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
