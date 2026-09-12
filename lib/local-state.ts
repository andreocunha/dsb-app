'use client';
import { useCallback, useSyncExternalStore } from 'react';
const memory = new Map<string, string>();
function subscribe(callback: () => void) {
  window.addEventListener('dsb-storage', callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener('dsb-storage', callback); window.removeEventListener('storage', callback); };
}
export function useLocalState<T>(key: string, initial: T): [T, (value: T) => void] {
  const fallback = JSON.stringify(initial);
  const getSnapshot = useCallback(() => {
    if (memory.has(key)) return memory.get(key)!;
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }, [key, fallback]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  let value = initial;
  try { value = JSON.parse(raw) as T; } catch { /* Invalid data uses defaults. */ }
  const setValue = (next: T) => {
    const serialized = JSON.stringify(next);
    try { localStorage.setItem(key, serialized); memory.delete(key); } catch { memory.set(key, serialized); }
    window.dispatchEvent(new Event('dsb-storage'));
  };
  return [value, setValue];
}
