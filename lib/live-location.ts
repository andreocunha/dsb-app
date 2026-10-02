'use client';
import { supabase } from './supabase';

// Quem está compartilhando a localização em tempo real manda a posição enquanto o app está aberto,
// em qualquer tela (não só na conversa). Fica no módulo: é um só GPS para todas as conversas.
// Com o app fechado o celular não manda nada, e quem vê fica com "Atualizada há X min" (o WhatsApp faz
// o mesmo quando o sistema corta o app em segundo plano).

const EVERY = 10_000; // no máximo uma posição a cada 10 s
const HEARTBEAT = 30_000; // parado no lugar: repete a última, para os outros verem "Atualizada agora"

let watchId: number | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let last: GeolocationPosition | null = null;
let sentAt = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Está mandando a posição agora (para mostrar o aviso de compartilhamento). */
export const isSharingLive = () => watchId !== null;
export function subscribeSharing(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const changed = () => listeners.forEach(listener => listener());

async function send() {
  trailing = null;
  if (!last) return;
  sentAt = Date.now();
  const { latitude, longitude, accuracy, heading } = last.coords;
  const { data, error } = await supabase.rpc('update_live_location', {
    p_lat: latitude, p_lng: longitude, p_accuracy: accuracy ?? undefined,
    p_heading: heading != null && Number.isFinite(heading) ? heading : undefined,
  });
  // Acabou o prazo, parou em outro aparelho ou saiu do grupo: desliga o GPS.
  if (!error && data === 0) stopWatching();
}

function onPosition(position: GeolocationPosition) {
  last = position;
  const wait = EVERY - (Date.now() - sentAt);
  if (wait <= 0) void send();
  else if (!trailing) trailing = setTimeout(() => void send(), wait);
}

function startWatching() {
  if (watchId !== null || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(onPosition, error => console.warn('Localização em tempo real sem GPS:', error.message),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 60_000 });
  heartbeat = setInterval(() => { if (Date.now() - sentAt >= HEARTBEAT - 1000) void send(); }, HEARTBEAT);
  changed();
}

export function stopWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (heartbeat) clearInterval(heartbeat);
  if (trailing) clearTimeout(trailing);
  watchId = null; heartbeat = null; trailing = null; last = null;
  changed();
}

/**
 * Confere no banco se há localização em tempo real sua ativa e liga ou desliga o GPS.
 * Chamado ao abrir o app, ao voltar para ele e depois de começar ou parar de compartilhar.
 */
export function syncLiveSharing(userId: string | null) {
  if (!userId) { stopWatching(); return Promise.resolve(); }
  syncing ??= (async () => {
    const { data } = await supabase.rpc('my_live_locations');
    if (data?.length) startWatching(); else stopWatching();
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Já tem uma posição na mão (a que acabou de ser enviada): começa daqui, sem esperar o GPS de novo. */
export function primeLivePosition(position: GeolocationPosition) {
  last = position;
  sentAt = Date.now();
}
