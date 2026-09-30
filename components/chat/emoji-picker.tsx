'use client';
import { useEffect, useRef } from 'react';

/**
 * Painel completo de emojis (categorias, busca e recentes), como o do WhatsApp.
 * O componente só é baixado quando o painel abre, e os dados vêm de public/emoji/pt.json
 * (sem CDN: o app funciona offline e dentro do Capacitor). Depois da primeira vez, ficam no IndexedDB.
 */
export function EmojiPicker({ onPick, className = '' }: { onPick: (emoji: string) => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  useEffect(() => { pick.current = onPick; }, [onPick]);
  useEffect(() => {
    let picker: HTMLElement | null = null;
    let cancelled = false;
    void Promise.all([import('emoji-picker-element/picker'), import('emoji-picker-element/i18n/pt_BR')]).then(([{ default: Picker }, { default: i18n }]) => {
      if (cancelled || !box.current) return;
      const element = new Picker({ locale: 'pt', dataSource: '/emoji/pt.json', i18n, skinToneEmoji: '👍' });
      element.addEventListener('emoji-click', e => { if (e.detail.unicode) pick.current(e.detail.unicode); });
      box.current.appendChild(element);
      picker = element;
    });
    return () => { cancelled = true; picker?.remove(); };
  }, []);
  return <div ref={box} className={`emoji-panel ${className}`} />;
}
