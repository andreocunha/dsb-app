'use client';
import Image from 'next/image';
import { registerOverlay } from '@/lib/overlays';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { Team } from '@/lib/data';
import { avatarImage } from '@/lib/images';
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
  if (url) return <img className={className} src={avatarImage(url)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
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
 * Abre e fecha com animação; no mobile, arrastar para baixo (em qualquer lugar, com a lista no topo) fecha.
 *
 * Detalhes abrem DENTRO do mesmo sheet, nunca outro por cima: `page` identifica o conteúdo atual e,
 * com `onBack`, aparece a seta de voltar (o voltar do Android e o Esc também voltam em vez de fechar).
 * `depth` diz o sentido da troca (mais fundo desliza da direita); cada página guarda a própria rolagem.
 */
export function Sheet({ open, onClose, onBack, page = '', depth = 0, title, subtitle, actions, size = 'default', children }: {
  open: boolean; onClose: () => void; onBack?: () => void; page?: string; depth?: number;
  title: string; subtitle?: string; actions?: React.ReactNode;
  size?: 'default' | 'large'; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Guardado em ref para o efeito não depender da identidade da função e reabrir o diálogo a cada render.
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  const voltar = useRef(onBack);
  useEffect(() => { voltar.current = onBack; }, [onBack]);

  // Troca de página: rolagem de cada uma guardada e o conteúdo novo desliza do lado certo.
  const body = useRef<HTMLDivElement>(null);
  const rolagens = useRef(new Map<string, number>());
  const atual = useRef({ page, depth });
  useLayoutEffect(() => {
    const anterior = atual.current;
    if (anterior.page === page) return;
    atual.current = { page, depth };
    const el = body.current;
    if (!el) return;
    el.scrollTop = rolagens.current.get(page) ?? 0;
    if (reduceMotion()) return;
    const lado = depth >= anterior.depth ? 1 : -1;
    el.animate([{ opacity: 0, transform: `translateX(${lado * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE });
  }, [page, depth]);
  // Fechado por arraste: o sheet já saiu deslizando no próprio toque; o efeito só tira da tela.
  const arrastadoParaFora = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (!dialog.open) return;
      // Fecha a partir de onde estiver (inclusive no meio de um arraste).
      const from = getComputedStyle(dialog).transform;
      // Reabrir antes de terminar cancela o fechamento (senão a garantia abaixo fecharia o sheet reaberto).
      let cancelled = false;
      const done = () => {
        if (cancelled || !dialog.open) return;
        dialog.style.transform = ''; dialog.style.transition = ''; dialog.close();
        // As animações de saída ficam presas (fill: forwards) até cancelar.
        dialog.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
      };
      if (reduceMotion() || arrastadoParaFora.current) { arrastadoParaFora.current = false; done(); return; }
      const frames = isModal()
        ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.98)' }]
        : [{ transform: from === 'none' ? 'translateY(0)' : from }, { transform: 'translateY(100%)' }];
      dialog.animate(frames, { duration: isModal() ? 140 : 220, easing: EASE, fill: 'forwards' }).finished.then(done, done);
      // Garantia: com a aba em segundo plano a animação não avança, mas o diálogo precisa fechar.
      const timer = setTimeout(done, 400);
      try { dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, pseudoElement: '::backdrop', fill: 'forwards' }); } catch { /* sem suporte: o fundo some junto */ }
      return () => { cancelled = true; clearTimeout(timer); };
    }
    // subtree: inclui o fundo (::backdrop), que também estava sumindo.
    dialog.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    dialog.style.transform = '';
    dialog.style.transition = '';
    if (!dialog.open) {
      dialog.showModal();
      // O foco vai para o sheet, não para o primeiro botão (evita o anel no X ao abrir com o mouse).
      dialog.focus();
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Voltar do Android: com uma página aberta dentro do sheet, volta para a anterior.
    const solta = registerOverlay(() => (voltar.current ? voltar.current() : fechar.current()));
    return () => { document.body.style.overflow = overflow; solta(); };
  }, [open]);
  // Desmontado aberto (ex.: troca de tela): some sem animação.
  useEffect(() => { const dialog = ref.current; return () => dialog?.close(); }, []);

  // Solta o arraste: fecha se desceu o bastante ou foi um puxão rápido para baixo; senão volta.
  function release(dy: number, speed: number) {
    const dialog = ref.current;
    if (!dialog) return;
    if (speed > -.2 && (dy > Math.min(140, dialog.offsetHeight * .25) || (dy > 24 && speed > .5))) {
      // Sai deslizando já, sem esperar o React (a troca de estado no meio travava 2 quadros no S10).
      // Continua na velocidade do dedo: puxão rápido sai rápido.
      const restante = Math.max(dialog.offsetHeight - dy, 0);
      const ms = Math.round(Math.min(Math.max(restante / Math.max(speed, 1.4), 140), 260));
      dialog.style.transition = '';
      dialog.style.transform = 'translateY(100%)';
      dialog.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(100%)' }], { duration: ms, easing: 'cubic-bezier(.25, .6, .35, 1)' });
      try { dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, pseudoElement: '::backdrop', fill: 'forwards' }); } catch { /* sem suporte: o fundo some junto */ }
      arrastadoParaFora.current = true;
      setTimeout(() => fechar.current(), ms);
      return;
    }
    dialog.style.transition = `transform .2s ${EASE}`;
    dialog.style.transform = '';
  }
  // Para cima resiste; para baixo acompanha o dedo.
  const follow = (dialog: HTMLElement, dy: number) => { dialog.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`; };

  // No toque, arrastar para baixo em qualquer lugar do sheet fecha, como nos apps nativos.
  // Com uma lista rolada, o gesto rola a lista; só um novo arraste, com ela já no topo, puxa o sheet.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let gesture: { x: number; y: number; dy: number; lastY: number; lastT: number; speed: number; state: 'pending' | 'drag' | 'skip' } | null = null;
    const onStart = (e: TouchEvent) => {
      gesture = null;
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || isModal() || target.closest('input, textarea, select, [contenteditable="true"], [data-no-sheet-drag]')) return;
      // Algum trecho rolável entre o dedo e o sheet fora do topo: o gesto é da rolagem.
      let scrolled = false;
      for (let el: HTMLElement | null = target; el && el !== dialog; el = el.parentElement) {
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) { scrolled = true; break; }
      }
      const touch = e.touches[0];
      gesture = { x: touch.clientX, y: touch.clientY, dy: 0, lastY: touch.clientY, lastT: e.timeStamp, speed: 0, state: scrolled ? 'skip' : 'pending' };
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture || gesture.state === 'skip') return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.state === 'pending') {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        // Para cima ou para o lado (ex.: carrossel) fica com o conteúdo.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { gesture.state = 'skip'; return; }
        gesture.state = 'drag';
        dialog.style.transition = 'none';
        // Camada própria já no primeiro movimento: o sheet só desliza, sem redesenhar o conteúdo.
        dialog.style.willChange = 'transform';
      }
      e.preventDefault();
      const dt = Math.max(e.timeStamp - gesture.lastT, 1);
      gesture.speed = gesture.speed * .3 + (touch.clientY - gesture.lastY) / dt * .7;
      gesture.lastY = touch.clientY; gesture.lastT = e.timeStamp; gesture.dy = dy;
      follow(dialog, dy);
    };
    const onEnd = () => {
      if (gesture?.state === 'drag') { release(gesture.dy, gesture.speed); dialog.style.willChange = ''; }
      gesture = null;
    };
    dialog.addEventListener('touchstart', onStart, { passive: true });
    dialog.addEventListener('touchmove', onMove, { passive: false });
    dialog.addEventListener('touchend', onEnd);
    dialog.addEventListener('touchcancel', onEnd);
    return () => {
      dialog.removeEventListener('touchstart', onStart);
      dialog.removeEventListener('touchmove', onMove);
      dialog.removeEventListener('touchend', onEnd);
      dialog.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Com mouse (janela estreita no computador), arrasta pela alça ou pelo título.
  function startDrag(event: React.PointerEvent) {
    const dialog = ref.current;
    if (!dialog || event.pointerType !== 'mouse' || isModal() || event.button !== 0 || (event.target as HTMLElement).closest('button, select, a, input')) return;
    const startY = event.clientY;
    let dy = 0, lastY = startY, lastT = event.timeStamp, speed = 0;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    dialog.style.transition = 'none';
    const onMove = (e: PointerEvent) => {
      dy = e.clientY - startY;
      speed = (e.clientY - lastY) / Math.max(e.timeStamp - lastT, 1);
      lastY = e.clientY; lastT = e.timeStamp;
      follow(dialog, dy);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('lostpointercapture', onUp);
      release(dy, speed);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('lostpointercapture', onUp);
  }

  return <dialog ref={ref} tabIndex={-1} className={`sheet ${size}`} onCancel={e => { e.preventDefault(); e.stopPropagation(); (onBack ?? onClose)(); }}
    // O Esc é deste sheet: não chega aos painéis de baixo (dados do grupo fecham com Esc na janela).
    onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="sheet-content">
      <div className="sheet-grab" onPointerDown={startDrag}>
        <span className="sheet-handle" />
        <div className="sheet-title">
          {onBack && <button className="icon-button sheet-back" onClick={onBack} aria-label="Voltar"><ArrowLeft size={20} /></button>}
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <div className="sheet-actions">{actions}<button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></div>
        </div>
      </div>
      <div className="sheet-body" ref={body} onScroll={e => rolagens.current.set(atual.current.page, e.currentTarget.scrollTop)}>{children}</div>
    </div>
  </dialog>;
}
