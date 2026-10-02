'use client';
import Image from 'next/image';
import { registerOverlay } from '@/lib/overlays';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Team } from '@/lib/data';
export function Brand() {
  return <div className="brand">
    <Image src="/images/logo.png" width={40} height={40} alt="" className="brand-logo" />
    <span className="brand-wordmark">SOLAR<br />BRASIL</span>
  </div>;
}
export function TeamBadge({ team, small = false }: { team: Pick<Team, 'initials' | 'color' | 'logo'>; small?: boolean }) {
  if (team.logo) return <img className={`team-badge team-logo ${small ? 'small' : ''}`} src={`/logos/${team.logo}`} alt="" loading="lazy" />;
  return <span className={`team-badge color-${team.color} ${small ? 'small' : ''}`}>{team.initials}</span>;
}
/** Foto do perfil ou iniciais coloridas de forma estável pelo id. */
/** letter: só a primeira letra, branca sobre cor forte, como a foto padrão das contas Google. */
export function Avatar({ id, name, url, small = false, letter = false }: { id: string; name: string; url?: string | null; small?: boolean; letter?: boolean }) {
  const className = `avatar ${small ? 'small' : ''} ${letter ? 'letter' : ''}`;
  if (url) return <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  const colors = ['green', 'gold', 'blue', 'orange', 'purple', 'cyan'];
  const color = colors[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % colors.length];
  const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, letter ? 1 : 2).toUpperCase();
  return <span className={`${className} color-${color}`}>{initials}</span>;
}
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isModal = () => window.matchMedia('(min-width: 640px)').matches;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';

/**
 * Bottom sheet no mobile, modal centralizado a partir de 640px (ver .sheet no CSS).
 * Abre e fecha com animação; no mobile, arrastar o topo para baixo fecha.
 */
export function Sheet({ open, onClose, title, subtitle, actions, size = 'default', children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; actions?: React.ReactNode;
  size?: 'default' | 'large'; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Guardado em ref para o efeito não depender da identidade da função e reabrir o diálogo a cada render.
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (!dialog.open) return;
      // Fecha a partir de onde estiver (inclusive no meio de um arraste).
      const from = getComputedStyle(dialog).transform;
      const done = () => { if (!dialog.open) return; dialog.style.transform = ''; dialog.style.transition = ''; dialog.close(); };
      if (reduceMotion()) { done(); return; }
      const frames = isModal()
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.98)' }]
        : [{ transform: from === 'none' ? 'translateY(0)' : from }, { transform: 'translateY(100%)' }];
      dialog.animate(frames, { duration: isModal() ? 140 : 220, easing: EASE, fill: 'forwards' }).finished.then(done, done);
      // Garantia: com a aba em segundo plano a animação não avança, mas o diálogo precisa fechar.
      setTimeout(done, 400);
      try { dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, pseudoElement: '::backdrop', fill: 'forwards' }); } catch { /* sem suporte: o fundo some junto */ }
      return;
    }
    dialog.getAnimations().forEach(animation => animation.cancel());
    if (!dialog.open) {
      dialog.showModal();
      // O foco vai para o sheet, não para o primeiro botão (evita o anel no X ao abrir com o mouse).
      dialog.focus();
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const solta = registerOverlay(() => fechar.current());
    return () => { document.body.style.overflow = overflow; solta(); };
  }, [open]);
  // Desmontado aberto (ex.: troca de tela): some sem animação.
  useEffect(() => { const dialog = ref.current; return () => dialog?.close(); }, []);

  // Arrastar para baixo pela alça ou pelo título.
  function startDrag(event: React.PointerEvent) {
    const dialog = ref.current;
    if (!dialog || isModal() || event.button !== 0 || (event.target as HTMLElement).closest('button, select, a, input')) return;
    const startY = event.clientY, startT = performance.now();
    let dy = 0;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dialog.style.transition = 'none';
    const onMove = (e: PointerEvent) => {
      dy = e.clientY - startY;
      // Para cima resiste; para baixo acompanha o dedo.
      dialog.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('lostpointercapture', onUp);
      const speed = dy / Math.max(performance.now() - startT, 1);
      if (dy > Math.min(140, dialog.offsetHeight * .25) || (dy > 24 && speed > .6)) { fechar.current(); return; }
      dialog.style.transition = `transform .2s ${EASE}`;
      dialog.style.transform = '';
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('lostpointercapture', onUp);
  }

  return <dialog ref={ref} tabIndex={-1} className={`sheet ${size}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="sheet-content">
      <div className="sheet-grab" onPointerDown={startDrag}>
        <span className="sheet-handle" />
        <div className="sheet-title">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <div className="sheet-actions">{actions}<button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></div>
        </div>
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  </dialog>;
}
