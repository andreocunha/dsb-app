'use client';
import { useSyncExternalStore } from 'react';

// Mesmo corte do app: a partir de 900px é o layout do WhatsApp Web; abaixo, o do celular.
export const WIDE = '(min-width: 900px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export function useWide() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
}
