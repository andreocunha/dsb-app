'use client';
import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { registerOverlay } from '@/lib/overlays';
import { REACTIONS } from './types';
import type { MenuRequest } from './message';

export type MenuAction = { id: string; label: string; icon: React.ReactNode; danger?: boolean };

const BAR_H = 52, ITEM_H = 46, GAP = 8, EDGE = 10, BAR_W = 320;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/**
 * Menu de uma mensagem, nos três jeitos do WhatsApp:
 * full = toque longo no celular (fundo escurecido, reações em cima, balão em destaque, ações embaixo);
 * menu = setinha do balão ou clique direito no desktop; reactions = carinha ao lado do balão.
 */
export function MessageMenu({ request, own, myReaction, actions, onAction, onReact, onMoreReactions, onClose, children }: {
  request: MenuRequest; own: boolean; myReaction: string | null; actions: MenuAction[]; onAction: (id: string) => void;
  onReact: (emoji: string) => void; onMoreReactions: () => void; onClose: () => void; children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    openedAt.current = performance.now();
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const solta = registerOverlay(() => fechar.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    const onResize = () => fechar.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { solta(); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, []);

  // O mesmo toque que abriu o menu não pode fechá-lo ao soltar o dedo.
  const backdrop = (e: React.MouseEvent) => { if (e.target === e.currentTarget && performance.now() - openedAt.current > 350) onClose(); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...box.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const vw = window.innerWidth, vh = window.innerHeight;
  const { rect, mode } = request;
  const bar = <div className="reaction-bar" role="group" aria-label="Reagir">
    {REACTIONS.map(emoji => <button key={emoji} type="button" role="menuitem" className={emoji === myReaction ? 'mine' : ''} onClick={() => onReact(emoji)} aria-label={`Reagir com ${emoji}`}>{emoji}</button>)}
    <button type="button" role="menuitem" className="reaction-more" onClick={onMoreReactions} aria-label="Mais emojis"><Plus size={20} /></button>
  </div>;
  const list = actions.length > 0 && <div className="menu-list" role="menu">
    {actions.map(action => <button key={action.id} type="button" role="menuitem" className={action.danger ? 'danger' : ''} onClick={() => onAction(action.id)}>
      <span>{action.label}</span>{action.icon}
    </button>)}
  </div>;

  if (mode === 'full') {
    const listH = actions.length * ITEM_H + 12;
    const cloneH = Math.min(rect.height, vh * .4);
    const total = BAR_H + GAP + cloneH + GAP + listH;
    const top = clamp(rect.top - BAR_H - GAP, EDGE, Math.max(EDGE, vh - EDGE - total));
    const width = Math.max(rect.width, BAR_W);
    const side = own ? { right: clamp(vw - rect.right, EDGE, vw - EDGE - width) } : { left: clamp(rect.left, EDGE, vw - EDGE - width) };
    return <div className="menu-layer dim" onClick={backdrop}>
      <div ref={box} className={`menu-stack ${own ? 'own' : ''}`} style={{ top, ...side }} onKeyDown={onKeyDown} onClick={backdrop}>
        {bar}
        <div className="menu-clone" style={{ width: rect.width + 16, maxHeight: cloneH }} aria-hidden>{children}</div>
        {list}
      </div>
    </div>;
  }

  const point = request.point ?? { x: own ? rect.right : rect.left, y: rect.bottom };
  const width = BAR_W;
  const height = mode === 'reactions' ? BAR_H : actions.length * ITEM_H + 12 + BAR_H + GAP;
  const left = clamp(mode === 'reactions' ? point.x - width / 2 : own ? point.x - width : point.x, EDGE, vw - EDGE - width);
  const top = mode === 'reactions'
    ? (point.y - height - GAP > EDGE ? point.y - height - GAP : point.y + 32)
    : (point.y + height + EDGE < vh ? point.y : Math.max(EDGE, point.y - height));
  return <div className="menu-layer" onClick={backdrop} onContextMenu={e => { e.preventDefault(); onClose(); }}>
    <div ref={box} className={`menu-stack dropdown ${own ? 'own' : ''}`} style={{ top, left, width }} onKeyDown={onKeyDown}>
      {bar}
      {mode === 'menu' && list}
    </div>
  </div>;
}
