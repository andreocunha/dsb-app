'use client';
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Sheet } from './ui';

const OUTPUT = 512;
const MAX_ZOOM = 4;
type View = { zoom: number; x: number; y: number };
const clamp = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit);

/**
 * Enquadrar a foto do perfil, como no WhatsApp: arrastar move, pinça/roda/controle dão zoom
 * e o círculo mostra o que vai aparecer. Devolve um JPEG quadrado de 512px.
 * x e y são o deslocamento em frações do quadro, para não depender do tamanho da tela.
 */
export function PhotoCrop({ file, onCancel, onConfirm, busy }: {
  file: File | null; onCancel: () => void; onConfirm: (blob: Blob) => void; busy: boolean;
}) {
  const [image, setImage] = useState<{ file: File; el: HTMLImageElement } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; dist: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { setImage({ file, el }); setView({ zoom: 1, x: 0, y: 0 }); };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const img = image && image.file === file ? image.el : null;

  // Quanto a imagem passa do quadro em cada eixo (1 = do tamanho do quadro).
  const cover = (zoom: number) => {
    if (!img) return { w: 1, h: 1 };
    const short = Math.min(img.naturalWidth, img.naturalHeight);
    return { w: img.naturalWidth / short * zoom, h: img.naturalHeight / short * zoom };
  };
  // A imagem sempre cobre o círculo inteiro: sem bordas vazias.
  const fit = ({ zoom, x, y }: View): View => {
    const z = Math.min(Math.max(zoom, 1), MAX_ZOOM);
    const { w, h } = cover(z);
    return { zoom: z, x: clamp(x, (w - 1) / 2), y: clamp(y, (h - 1) / 2) };
  };
  const zoomTo = (zoom: number) => setView(current => fit({ ...current, zoom }));

  // Roda do mouse dá zoom; precisa de listener não passivo para a página não rolar junto.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setView(current => fit({ ...current, zoom: current.zoom * Math.exp(-e.deltaY * .002) })); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function snapshot() {
    const list = [...pointers.current.values()];
    const cx = list.reduce((s, p) => s + p.x, 0) / list.length, cy = list.reduce((s, p) => s + p.y, 0) / list.length;
    const dist = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
    gesture.current = { view, dist, cx, cy };
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshot();
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const list = [...pointers.current.values()];
    const size = stage.current!.clientWidth;
    const start = gesture.current;
    const cx = list.reduce((s, p) => s + p.x, 0) / list.length, cy = list.reduce((s, p) => s + p.y, 0) / list.length;
    const zoom = list.length > 1 && start.dist ? start.view.zoom * Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) / start.dist : start.view.zoom;
    setView(fit({ zoom, x: start.view.x + (cx - start.cx) / size, y: start.view.y + (cy - start.cy) / size }));
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) snapshot(); else gesture.current = null;
  }
  function onKeyDown(e: React.KeyboardEvent) {
    const step = .02;
    const moves: Record<string, Partial<View>> = { ArrowLeft: { x: view.x + step }, ArrowRight: { x: view.x - step }, ArrowUp: { y: view.y + step }, ArrowDown: { y: view.y - step } };
    if (moves[e.key]) { e.preventDefault(); setView(fit({ ...view, ...moves[e.key] })); }
    if (e.key === '+' || e.key === '=') zoomTo(view.zoom * 1.1);
    if (e.key === '-') zoomTo(view.zoom / 1.1);
  }

  async function confirm() {
    if (!img) return;
    const short = Math.min(img.naturalWidth, img.naturalHeight);
    const size = short / view.zoom;
    const sx = img.naturalWidth / 2 - view.x * short / view.zoom - size / 2;
    const sy = img.naturalHeight / 2 - view.y * short / view.zoom - size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(OUTPUT, Math.round(size));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (blob) onConfirm(blob);
  }

  const { w, h } = cover(view.zoom);
  return <Sheet open={file !== null} onClose={onCancel} title="Ajustar foto" subtitle="Arraste para enquadrar e use o zoom.">
    <div className="photo-crop">
      <div ref={stage} className="photo-crop-stage" data-no-sheet-drag tabIndex={0} aria-label="Enquadramento da foto. Use as setas para mover e + ou - para o zoom."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown}>
        {img && <img src={img.src} alt="" draggable={false}
          style={{ width: `${w * 100}%`, height: `${h * 100}%`, transform: `translate(-50%, -50%) translate(${view.x * 100 / w}%, ${view.y * 100 / h}%)` }} />}
        <span className="photo-crop-mask" aria-hidden />
      </div>
      <div className="photo-crop-zoom">
        <button className="icon-button" onClick={() => zoomTo(view.zoom / 1.2)} disabled={view.zoom <= 1} aria-label="Diminuir zoom"><Minus size={18} /></button>
        <input type="range" min={1} max={MAX_ZOOM} step={.01} value={view.zoom} onChange={e => zoomTo(Number(e.target.value))} aria-label="Zoom" />
        <button className="icon-button" onClick={() => zoomTo(view.zoom * 1.2)} disabled={view.zoom >= MAX_ZOOM} aria-label="Aumentar zoom"><Plus size={18} /></button>
      </div>
      <div className="photo-crop-actions">
        <button className="button" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="button primary" onClick={() => void confirm()} disabled={!img || busy}>{busy ? 'Salvando…' : 'Usar foto'}</button>
      </div>
    </div>
  </Sheet>;
}
