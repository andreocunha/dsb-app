'use client';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { X, Sun } from 'lucide-react';
import type { Team } from '@/lib/mock-data';
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><Image src="/images/event-logo.png" width={56} height={56} alt="Solar Brasil" className="brand-official" /><span className="brand-name">dsb<span>.</span></span>{!compact && <span className="brand-caption">DESAFIO<br />SOLAR BRASIL</span>}</div>;
}
export function TeamBadge({ team, small = false }: { team: Team; small?: boolean }) {
  return <span className={`team-badge color-${team.color} ${small ? 'small' : ''}`}><Sun size={small ? 12 : 16} /><b>{team.initials}</b></span>;
}
export function Sheet({ open, onClose, title, children, className = '' }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open) { dialog?.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog?.close(); document.body.style.overflow = overflow; }; }
  }, [open]);
  return <dialog ref={ref} className={`sheet ${className}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-label={title}><div className="sheet-content"><span className="sheet-handle" /><div className="sheet-title"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></div>{children}</div></dialog>;
}
