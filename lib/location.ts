// Localização no chat, como no WhatsApp. Funções puras testadas em tests/location.test.mjs,
// mais o acesso ao GPS do aparelho.

/**
 * O ponto salvo em messages.location. live_until só existe na localização em tempo real;
 * name e address, no ponto marcado no mapa (o endereço do lugar, como no WhatsApp).
 */
export type Place = { lat: number; lng: number; accuracy?: number; live_until?: string; name?: string; address?: string };
/** Onde a pessoa está agora numa localização em tempo real (live_locations). */
export type LivePosition = { lat: number; lng: number; accuracy: number | null; heading: number | null; updated_at: string };

/** As durações que o WhatsApp oferece. */
export const LIVE_OPTIONS = [
  { minutes: 15, label: '15 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 480, label: '8 horas' },
] as const;

export function asPlace(value: unknown): Place | null {
  if (!value || typeof value !== 'object') return null;
  const { lat, lng, accuracy, live_until, name, address } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    lat, lng, ...(typeof accuracy === 'number' ? { accuracy } : {}), ...(typeof live_until === 'string' ? { live_until } : {}),
    ...(typeof name === 'string' ? { name } : {}), ...(typeof address === 'string' ? { address } : {}),
  };
}

export const isLivePlace = (place: Place | null) => !!place?.live_until;
/** Tem algo escrito embaixo do mapa no balão (em tempo real, ou o nome/endereço do lugar): a hora não vai em cima do mapa. */
export const hasPlaceText = (place: Place | null) => !!place && (!!place.live_until || !!place.name || !!place.address);
/** Texto curto (citação, lista de conversas): o nome do lugar, "Localização" ou "Localização em tempo real". */
export const placeLabel = (place: Place | null) => place?.live_until ? 'Localização em tempo real' : place?.name || place?.address || 'Localização';
/** Em tempo real e ainda dentro do prazo (parar de compartilhar traz o prazo para agora). */
export const isSharing = (place: Place | null, now = Date.now()) => !!place?.live_until && new Date(place.live_until).getTime() > now;

/** "Precisão de 12 metros", como no WhatsApp; acima de 1 km em quilômetros. */
export function accuracyLabel(meters: number | null | undefined) {
  if (meters == null || !Number.isFinite(meters)) return '';
  const m = Math.max(1, Math.round(meters));
  if (m >= 1000) return `Precisão de ${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  return `Precisão de ${m} ${m === 1 ? 'metro' : 'metros'}`;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Embaixo do mapa da localização em tempo real: "Ativa até 15:30" ou "Localização em tempo real encerrada". */
export function liveUntilLabel(place: Place, now = Date.now()) {
  if (!place.live_until) return '';
  return isSharing(place, now) ? `Ativa até ${clock(place.live_until)}` : 'Localização em tempo real encerrada';
}

/** "Atualizada agora", "Atualizada há 5 min", "Atualizada há 2 h", senão "Atualizada às 14:32". */
export function updatedLabel(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Atualizada agora';
  if (minutes < 60) return `Atualizada há ${minutes} min`;
  if (minutes < 6 * 60) return `Atualizada há ${Math.floor(minutes / 60)} h`;
  return `Atualizada às ${clock(iso)}`;
}

/** Quanto falta para acabar: "14 min restantes", "1 h restante", "7 h e 30 min restantes". */
export function remainingLabel(until: string, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((new Date(until).getTime() - now) / 60_000));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min ${m === 1 ? 'restante' : 'restantes'}`;
  return m ? `${h} h e ${m} min restantes` : `${h} h ${h === 1 ? 'restante' : 'restantes'}`;
}

/** Distância em metros entre dois pontos (haversine). */
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, R = 6_371_000;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Posição em pixels no mapa do mundo (Web Mercator, ladrilhos de 256px), como os mapas da web desenham. */
export function project(lat: number, lng: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
  return { x: (lng + 180) / 360 * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

/**
 * Ladrilhos que cobrem uma janela de width x height px centrada no ponto: cada um com a posição
 * em relação ao centro (dx, dy), para desenhar o mapa sem biblioteca.
 */
export function tilesAround(lat: number, lng: number, zoom: number, width: number, height: number) {
  const { x, y } = project(lat, lng, zoom);
  const max = 2 ** zoom;
  const tiles: { z: number; x: number; y: number; dx: number; dy: number }[] = [];
  for (let ty = Math.floor((y - height / 2) / 256); ty <= Math.floor((y + height / 2) / 256); ty++) {
    if (ty < 0 || ty >= max) continue;
    for (let tx = Math.floor((x - width / 2) / 256); tx <= Math.floor((x + width / 2) / 256); tx++) {
      tiles.push({ z: zoom, x: ((tx % max) + max) % max, y: ty, dx: tx * 256 - x, dy: ty * 256 - y });
    }
  }
  return tiles;
}

/** Mapa do OpenStreetMap (gratuito, com crédito na tela). */
export const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export const TILE_ATTRIBUTION = '© OpenStreetMap';

type Nominatim = { name?: string; display_name?: string; address?: Record<string, string | undefined> };

/**
 * Nome e endereço curtos a partir da busca reversa do OpenStreetMap, no jeito brasileiro:
 * "Rua Barata Ribeiro, 502 - Copacabana, Rio de Janeiro". name só quando é um lugar com nome próprio.
 */
export function formatPlace(data: Nominatim | null | undefined): { name?: string; address: string } | null {
  if (!data) return null;
  const a = data.address ?? {};
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.path ?? a.square;
  const district = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district;
  const city = a.city ?? a.town ?? a.village ?? a.municipality;
  let address = street ? `${street}${a.house_number ? `, ${a.house_number}` : ''}` : '';
  if (district) address = address ? `${address} - ${district}` : district;
  if (city) address = address ? `${address}, ${city}` : city;
  if (!address) address = (data.display_name ?? '').split(',').slice(0, 3).map(part => part.trim()).filter(Boolean).join(', ');
  const name = data.name?.trim();
  if (!address && !name) return null;
  return { ...(name && name !== street ? { name } : {}), address };
}

/** Endereço do ponto marcado no mapa (busca reversa do OpenStreetMap; nulo se não encontrar). */
export async function addressOf(lat: number, lng: number, signal?: AbortSignal) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`;
  const response = await fetch(url, { signal });
  return response.ok ? formatPlace(await response.json()) : null;
}

/** "a 350 m" ou "a 2,4 km" de você. */
export function distanceLabel(meters: number) {
  return meters < 1000 ? `a ${Math.max(1, Math.round(meters / 10) * 10)} m de você` : `a ${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km de você`;
}

/** Abre no app de mapas do aparelho (Google Maps no Android e na web, Mapas da Apple no iPhone). */
export function mapsUrl(lat: number, lng: number, apple = false) {
  return apple ? `https://maps.apple.com/?q=${lat},${lng}&ll=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Erro do GPS em português, dizendo o que fazer. */
export function geoErrorMessage(error: { code?: number } | null | undefined) {
  if (error?.code === 1) return 'Permita o acesso à localização para o DSB nas configurações do celular ou do navegador.';
  if (error?.code === 3) return 'A localização demorou para responder. Tente de novo em um lugar aberto.';
  return 'Não foi possível encontrar sua localização. Verifique se o GPS está ligado.';
}

export const canLocate = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

/** Uma leitura do GPS (a mais precisa possível, sem aproveitar posição velha). */
export function currentPosition(timeout = 20_000) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!canLocate()) { reject({ code: 2 }); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout });
  });
}
