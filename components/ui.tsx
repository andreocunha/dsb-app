'use client';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Team } from '@/lib/data';
export function Brand() {
  return <div className="brand">
    <Image src="/images/event-logo.png" width={40} height={40} alt="" className="brand-logo" />
    <span className="brand-wordmark">SOLAR<br />BRASIL</span>
  </div>;
}
export function TeamBadge({ team, small = false }: { team: Pick<Team, 'initials' | 'color' | 'logo'>; small?: boolean }) {
  if (team.logo) return <img className={`team-badge team-logo ${small ? 'small' : ''}`} src={`/logos/${team.logo}`} alt="" loading="lazy" />;
  return <span className={`team-badge color-${team.color} ${small ? 'small' : ''}`}>{team.initials}</span>;
}
/** Foto do perfil ou iniciais coloridas de forma estável pelo id. */
export function Avatar({ id, name, url, small = false }: { id: string; name: string; url?: string | null; small?: boolean }) {
  const className = `avatar ${small ? 'small' : ''}`;
  if (url) return <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  const colors = ['green', 'gold', 'blue', 'orange', 'purple', 'cyan'];
  const color = colors[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % colors.length];
  const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  return <span className={`${className} color-${color}`}>{initials}</span>;
}
/** Bottom sheet no mobile, modal centralizado a partir de 640px (ver .sheet no CSS). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open) { dialog?.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog?.close(); document.body.style.overflow = overflow; }; }
  }, [open]);
  return <dialog ref={ref} className="sheet" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}>
    <div className="sheet-content">
      <span className="sheet-handle" />
      <div className="sheet-title"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></div>
      {children}
    </div>
  </dialog>;
}
