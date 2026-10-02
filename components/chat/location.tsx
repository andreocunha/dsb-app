'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { ArrowLeft, LocateFixed, MapPin, Minus, MousePointerClick, Navigation, Plus, Radio, SendHorizontal, X } from 'lucide-react';
import { whenLabel } from '@/lib/chat-format';
import {
  accuracyLabel, addressOf, asPlace, canLocate, currentPosition, distance, distanceLabel, geoErrorMessage, isSharing, LIVE_OPTIONS, liveUntilLabel, mapsUrl,
  remainingLabel, TILE_ATTRIBUTION, tilesAround, tileUrl, updatedLabel,
} from '@/lib/location';
import { shortName } from '@/lib/names';
import { registerOverlay } from '@/lib/overlays';
import { Avatar } from '../ui';
import type { Message } from './types';

/** O que sai do seletor: um ponto fixo, ou a localização em tempo real por N minutos (com comentário). */
export type LocationChoice = { lat: number; lng: number; accuracy?: number; minutes?: number; comment?: string; name?: string; address?: string; position?: GeolocationPosition };

/** Onde a pessoa está agora: a última posição da em tempo real, ou o ponto enviado. */
export const whereIs = (message: Message): { lat: number; lng: number } | null => message.live ?? asPlace(message.location);

/** Re-renderiza de tempos em tempos ("Atualizada há 2 min", "Ativa até 15:30" virando "encerrada"). */
function useNow(every: number, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every, enabled]);
  return now;
}

const PIN_PATH = 'M15 0C6.7 0 0 6.6 0 14.8 0 25.9 15 40 15 40s15-14.1 15-25.2C30 6.6 23.3 0 15 0z';

/** Alfinete vermelho do WhatsApp. */
export function Pin({ size = 40 }: { size?: number }) {
  return <svg className="map-pin" width={size * .75} height={size} viewBox="0 0 30 40" aria-hidden>
    <path d={PIN_PATH} fill="#e53935" />
    <circle cx="15" cy="14.5" r="5.5" fill="#fff" fillOpacity=".9" />
  </svg>;
}

/** Foto de quem compartilha, com a pontinha embaixo, no lugar do alfinete (verde: ativa; cinza: encerrada). */
function LiveMarker({ message, active }: { message: Message; active: boolean }) {
  return <span className={`live-marker ${active ? 'active' : ''}`}>
    <Avatar id={message.user_id} name={message.author_name} url={message.author_avatar} letter />
  </span>;
}

/** Mapa estático do balão: os ladrilhos em volta do ponto, sem biblioteca (leve para a conversa inteira). */
export function StaticMap({ lat, lng, zoom = 15, children }: { lat: number; lng: number; zoom?: number; children?: React.ReactNode }) {
  const tiles = tilesAround(lat, lng, zoom, 360, 220);
  return <span className="static-map">
    {tiles.map(t => <img key={`${t.z}/${t.x}/${t.y}/${t.dx}`} className="map-tile" src={tileUrl(t.z, t.x, t.y)} alt="" loading="lazy" draggable={false}
      style={{ left: `calc(50% + ${t.dx}px)`, top: `calc(50% + ${t.dy}px)` }} />)}
    <span className="static-map-marker">{children ?? <Pin />}</span>
    <span className="map-credit">{TILE_ATTRIBUTION}</span>
  </span>;
}

/**
 * Localização dentro do balão. Fixa: o mapa com o alfinete. Em tempo real: a foto de quem compartilha
 * no mapa, o prazo e "Parar de compartilhar" (sua) ou "Ver localização em tempo real" (dos outros).
 */
export function LocationAttachment({ message, own, meta, onOpen, onStop }: {
  message: Message; own: boolean; meta: React.ReactNode; onOpen?: (message: Message) => void; onStop?: (message: Message) => void;
}) {
  const place = asPlace(message.location)!;
  const live = !!place.live_until;
  const now = useNow(30_000, live);
  const active = isSharing(place, now);
  const here = whereIs(message)!;
  const open = (e: React.MouseEvent) => { e.stopPropagation(); onOpen?.(message); };
  const spacer = <span className="meta-spacer" aria-hidden>{meta}</span>;
  return <>
    <button type="button" className={`bubble-map ${live && !active ? 'ended' : ''}`} onClick={open} disabled={message.pending || !onOpen}
      aria-label={live ? 'Ver localização em tempo real' : 'Abrir localização no mapa'}>
      <StaticMap lat={here.lat} lng={here.lng}>{live ? <LiveMarker message={message} active={active} /> : undefined}</StaticMap>
      {live && active && <span className="bubble-map-label"><Radio size={13} />{liveUntilLabel(place, now)}</span>}
      {message.pending && <span className="media-round"><span className="spinner" /></span>}
    </button>
    {!live && (place.name || place.address) && <p className="place-info">
      {/* O espaço da hora vai no fim da última linha, como no texto do balão. */}
      {place.name && <strong>{place.name}{!place.address && !message.body && spacer}</strong>}
      {place.address && <small>{place.address}{!message.body && spacer}</small>}
    </p>}
    {live && <p className="live-info">
      {!active ? <span className="live-ended">Localização em tempo real encerrada</span>
        : own ? <button type="button" className="live-action stop" disabled={message.pending || !onStop} onClick={e => { e.stopPropagation(); onStop?.(message); }}>Parar de compartilhar</button>
        : <button type="button" className="live-action" onClick={open}>Ver localização em tempo real</button>}
      {!message.body && spacer}
    </p>}
  </>;
}

type Api = { L: typeof Leaflet; map: Leaflet.Map };

/** Mapa de verdade (arrastar, pinça), carregado só quando uma tela de localização abre. */
function useLeaflet(el: React.RefObject<HTMLDivElement | null>, initial: { lat: number; lng: number; zoom: number }) {
  const [api, setApi] = useState<Api | null>(null);
  const start = useRef(initial);
  useEffect(() => {
    let map: Leaflet.Map | undefined;
    let observer: ResizeObserver | undefined;
    let alive = true;
    void import('leaflet').then(mod => {
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? mod;
      if (!alive || !el.current) return;
      const { lat, lng, zoom } = start.current;
      const created = L.map(el.current, { zoomControl: false, attributionControl: false }).setView([lat, lng], zoom);
      map = created;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'map-tile' }).addTo(created);
      L.control.attribution({ prefix: false }).addAttribution(TILE_ATTRIBUTION).addTo(created);
      // O diálogo abre junto: o tamanho certo só existe depois, e muda ao girar a tela.
      observer = new ResizeObserver(() => created.invalidateSize());
      observer.observe(el.current);
      setApi({ L, map: created });
    });
    return () => { alive = false; observer?.disconnect(); map?.remove(); };
  }, [el]);
  return api;
}

/** Ícone do Leaflet a partir de um elemento já desenhado pelo React (o mesmo alfinete/foto do balão). */
function iconFrom(L: typeof Leaflet, el: HTMLElement | null, size: [number, number], anchor: [number, number]) {
  return L.divIcon({ html: el?.cloneNode(true) as HTMLElement ?? '', className: 'map-icon', iconSize: size, iconAnchor: anchor });
}

/** Bolinha azul de "você está aqui", com o círculo da precisão. */
function useMyDot(api: Api | null, position: GeolocationPosition | null) {
  const dot = useRef<{ dot: Leaflet.CircleMarker; ring: Leaflet.Circle } | null>(null);
  useEffect(() => {
    if (!api || !position) return;
    const at: [number, number] = [position.coords.latitude, position.coords.longitude];
    if (!dot.current) {
      dot.current = {
        ring: api.L.circle(at, { radius: position.coords.accuracy, color: '#1a73e8', weight: 1, opacity: .4, fillColor: '#1a73e8', fillOpacity: .12, interactive: false }).addTo(api.map),
        dot: api.L.circleMarker(at, { radius: 7, color: '#fff', weight: 2.5, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(api.map),
      };
    } else {
      dot.current.ring.setLatLng(at).setRadius(position.coords.accuracy);
      dot.current.dot.setLatLng(at);
    }
  }, [api, position]);
}

/** Tela cheia por cima da conversa, com o voltar do Android fechando. */
function useScreen(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    dialog.showModal();
    // O foco vai para a tela, não para o voltar (sem o anel no botão ao abrir com o toque).
    dialog.focus();
    const solta = registerOverlay(() => fechar.current());
    return () => { dialog.close(); solta(); };
  }, [open]);
  return ref;
}

// Sem GPS ainda: o mapa começa no Brasil inteiro e voa para a pessoa quando a posição chega.
const BRASIL = { lat: -14.2, lng: -51.9, zoom: 4 };

/** Alfinete do Leaflet (o mesmo desenho do Pin), com a animação de "cair" no lugar. */
const pinIcon = (L: typeof Leaflet) => L.divIcon({
  html: `<svg class="map-pin" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="${PIN_PATH}" fill="#e53935"/><circle cx="15" cy="14.5" r="5.5" fill="#fff" fill-opacity=".9"/></svg>`,
  className: 'map-icon map-pin-drop', iconSize: [30, 40], iconAnchor: [15, 40],
});

/** + e − no canto (no celular a pinça já faz isso). */
function MapZoom({ api }: { api: Api | null }) {
  if (!api) return null;
  return <div className="map-zoom only-pointer">
    <button type="button" onClick={() => api.map.zoomIn()} aria-label="Aproximar"><Plus size={20} /></button>
    <button type="button" onClick={() => api.map.zoomOut()} aria-label="Afastar"><Minus size={20} /></button>
  </div>;
}

/**
 * "Enviar localização" do WhatsApp: o mapa na sua posição, "Compartilhar localização em tempo real" e
 * "Enviar sua localização atual" (com a precisão). Tocar no mapa marca outro lugar com o alfinete vermelho
 * (que dá para arrastar para acertar), com o endereço, e aparece "Enviar esta localização".
 * audience: quem vai ver a em tempo real ("Ana verá"). notice: aviso extra (no grupo geral, que é público).
 */
export function LocationSend({ open, audience, notice, onClose, onSend }: {
  open: boolean; audience: string; notice?: string; onClose: () => void; onSend: (choice: LocationChoice) => void;
}) {
  const ref = useScreen(open, onClose);
  return <dialog ref={ref} tabIndex={-1} className="location-screen" onCancel={e => { e.preventDefault(); onClose(); }} aria-label="Enviar localização">
    {open && <LocationPicker audience={audience} notice={notice} onClose={onClose} onSend={onSend} />}
  </dialog>;
}

type Spot = { lat: number; lng: number };

function LocationPicker({ audience, notice, onClose, onSend }: { audience: string; notice?: string; onClose: () => void; onSend: (choice: LocationChoice) => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const api = useLeaflet(mapEl, BRASIL);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState(canLocate() ? '' : geoErrorMessage(null));
  const [step, setStep] = useState<'pick' | 'live'>('pick');
  const [minutes, setMinutes] = useState<number>(60);
  const [comment, setComment] = useState('');
  // Lugar marcado com um toque no mapa, e o endereço dele (undefined: buscando; null: não achou).
  const [pin, setPin] = useState<Spot | null>(null);
  const [place, setPlace] = useState<{ key: string; value: { name?: string; address: string } | null } | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const followed = useRef(false);
  const moved = useRef(false);
  useMyDot(api, position);

  // GPS ligado enquanto a tela está aberta: a precisão melhora sozinha, como no WhatsApp.
  useEffect(() => {
    if (!canLocate()) return;
    const id = navigator.geolocation.watchPosition(p => { setPosition(p); setError(''); }, e => setError(geoErrorMessage(e)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Primeira posição: o mapa vai até você. Depois acompanha só enquanto você não mexer no mapa.
  useEffect(() => {
    if (!api || !position) return;
    const at: [number, number] = [position.coords.latitude, position.coords.longitude];
    if (!followed.current) { followed.current = true; if (!moved.current) api.map.setView(at, 17); return; }
    if (!moved.current && !pin) api.map.panTo(at, { animate: true });
  }, [api, position, pin]);

  // Toque marca o lugar; arrastar só mexe o mapa.
  useEffect(() => {
    if (!api) return;
    const onClick = (e: Leaflet.LeafletMouseEvent) => setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
    const onDrag = () => { moved.current = true; };
    api.map.on('click', onClick);
    api.map.on('dragstart', onDrag);
    return () => { api.map.off('click', onClick); api.map.off('dragstart', onDrag); };
  }, [api]);

  // O alfinete no mapa: cai onde você tocou e pode ser arrastado para acertar o ponto.
  useEffect(() => {
    if (!api) return;
    if (!pin || step !== 'pick') { marker.current?.remove(); marker.current = null; return; }
    if (marker.current) { marker.current.setLatLng([pin.lat, pin.lng]); return; }
    const created = api.L.marker([pin.lat, pin.lng], { icon: pinIcon(api.L), draggable: true, keyboard: false, autoPan: true }).addTo(api.map);
    created.on('dragend', () => { const at = created.getLatLng(); setPin({ lat: at.lat, lng: at.lng }); });
    marker.current = created;
  }, [api, pin, step]);

  // Endereço do lugar marcado, como o WhatsApp mostra embaixo de "Enviar esta localização".
  const pinKey = pin ? `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}` : '';
  useEffect(() => {
    if (!pin) return;
    const controller = new AbortController();
    const key = `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;
    const timer = setTimeout(() => {
      addressOf(pin.lat, pin.lng, controller.signal)
        .then(value => setPlace({ key, value }))
        .catch(error => { if (!controller.signal.aborted) setPlace({ key, value: null }); console.warn('Endereço não encontrado:', error); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pin]);
  const found = place?.key === pinKey ? place.value : undefined;

  function recenter() {
    moved.current = false;
    if (position && api) api.map.setView([position.coords.latitude, position.coords.longitude], Math.max(api.map.getZoom(), 16), { animate: true });
  }

  function live() {
    recenter();
    setStep('live');
  }

  const sendCurrent = () => position && onSend({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, position });
  const sendPin = () => pin && onSend({ lat: pin.lat, lng: pin.lng, ...(found ?? {}) });
  const status = error || 'Procurando sua localização…';
  const away = pin && position ? distance(pin, { lat: position.coords.latitude, lng: position.coords.longitude }) : null;
  const pinInfo = found === undefined ? 'Buscando endereço…' : [found?.name, found?.address].filter(Boolean).join(' · ') || `${pin?.lat.toFixed(5)}, ${pin?.lng.toFixed(5)}`;

  return <>
    <div className="location-bar">
      <button type="button" className="icon-button" onClick={step === 'live' ? () => setStep('pick') : onClose} aria-label="Voltar"><ArrowLeft size={22} /></button>
      <h2>{step === 'live' ? 'Localização em tempo real' : 'Enviar localização'}</h2>
    </div>
    <div className="location-map">
      <div ref={mapEl} className="leaflet-host" />
      {step === 'pick' && !pin && api && <span className="map-hint"><MousePointerClick size={15} />Toque no mapa para marcar um lugar</span>}
      <div className="map-fabs">
        <MapZoom api={api} />
        {position && <button type="button" className="map-fab" onClick={recenter} aria-label="Ir para a sua localização"><LocateFixed size={22} /></button>}
      </div>
    </div>
    {step === 'pick' ? <div className="location-options">
      {notice && <p className="location-notice">{notice}</p>}
      {pin && <div className="location-person location-pinned">
        <button type="button" className="location-option" onClick={sendPin} disabled={found === undefined}>
          <span className="location-icon pinned"><MapPin size={20} /></span>
          <span><strong>Enviar esta localização</strong><small>{pinInfo}{away !== null && found !== undefined ? ` · ${distanceLabel(away)}` : ''}</small></span>
        </button>
        <button type="button" className="icon-button" onClick={() => setPin(null)} aria-label="Tirar o alfinete"><X size={20} /></button>
      </div>}
      <button type="button" className="location-option" disabled={!position} onClick={live}>
        <span className="location-icon"><Radio size={20} /></span>
        <span><strong>Compartilhar localização em tempo real</strong>{!position && <small>{status}</small>}</span>
      </button>
      <button type="button" className="location-option" disabled={!position} onClick={sendCurrent}>
        <span className="location-icon"><LocateFixed size={20} /></span>
        <span><strong>Enviar sua localização atual</strong><small>{position ? accuracyLabel(position.coords.accuracy) : status}</small></span>
      </button>
    </div> : <form className="location-live" onSubmit={e => {
      e.preventDefault();
      if (position) onSend({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, minutes, comment: comment.trim(), position });
    }}>
      <p>{audience} sua localização em tempo real, atualizada enquanto o DSB estiver aberto no seu celular. Você pode parar quando quiser.</p>
      <div className="live-durations" role="radiogroup" aria-label="Por quanto tempo">
        {LIVE_OPTIONS.map(option => <button key={option.minutes} type="button" role="radio" aria-checked={minutes === option.minutes}
          onClick={() => setMinutes(option.minutes)}>{option.label}</button>)}
      </div>
      <div className="location-comment">
        <input value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} placeholder="Adicionar comentário" aria-label="Comentário" />
        <button type="submit" className="send-button" disabled={!position} aria-label="Compartilhar"><SendHorizontal size={22} /></button>
      </div>
    </form>}
  </>;
}

/**
 * Mapa da localização aberta. Fixa: o alfinete, quem mandou e "Abrir no Maps".
 * Em tempo real: todo mundo que está compartilhando nesta conversa, com a hora da última atualização,
 * e "Parar de compartilhar" na sua.
 */
export function LocationViewer({ message, live, userId, onClose, onStop }: {
  message: Message | null; live: Message[]; userId: string | null; onClose: () => void; onStop: (message: Message) => void;
}) {
  const ref = useScreen(!!message, onClose);
  return <dialog ref={ref} tabIndex={-1} className="location-screen" onCancel={e => { e.preventDefault(); onClose(); }} aria-label="Localização">
    {message && <LocationMap key={message.id} message={message} live={live} userId={userId} onClose={onClose} onStop={onStop} />}
  </dialog>;
}

function LocationMap({ message, live, userId, onClose, onStop }: {
  message: Message; live: Message[]; userId: string | null; onClose: () => void; onStop: (message: Message) => void;
}) {
  const place = asPlace(message.location)!;
  const isLive = !!place.live_until;
  const now = useNow(30_000, isLive);
  // Em tempo real: a aberta e as outras ainda ativas da conversa (uma por pessoa, a mais nova).
  const people = isLive ? live.filter(m => m.id === message.id || isSharing(asPlace(m.location), now))
    .filter((m, i, list) => m.id === message.id || !list.some((o, j) => j !== i && o.user_id === m.user_id && (o.id === message.id || o.id > m.id)))
    .sort((a, b) => (a.id === message.id ? -1 : b.id === message.id ? 1 : a.id - b.id)) : [message];
  const here = whereIs(message)!;
  const mapEl = useRef<HTMLDivElement>(null);
  const api = useLeaflet(mapEl, { ...here, zoom: 16 });
  const markers = useRef(new Map<number, Leaflet.Marker>());
  const icons = useRef(new Map<number, HTMLElement | null>());
  const fitted = useRef(false);
  const [me, setMe] = useState<GeolocationPosition | null>(null);
  useMyDot(api, me);
  const [apple] = useState(() => typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent));

  // Marcadores: criados uma vez e só mudam de lugar quando chega posição nova.
  useEffect(() => {
    if (!api) return;
    const seen = new Set<number>();
    for (const m of people) {
      const at = whereIs(m);
      if (!at) continue;
      seen.add(m.id);
      const existing = markers.current.get(m.id);
      const active = isSharing(asPlace(m.location), now);
      const icon = isLive ? iconFrom(api.L, icons.current.get(m.id) ?? null, [48, 56], [24, 56]) : pinIcon(api.L);
      if (existing) { existing.setLatLng([at.lat, at.lng]); existing.setIcon(icon); existing.getElement()?.classList.toggle('ended', !active); }
      else markers.current.set(m.id, api.L.marker([at.lat, at.lng], { icon, keyboard: false }).addTo(api.map));
    }
    for (const [id, marker] of markers.current) if (!seen.has(id)) { marker.remove(); markers.current.delete(id); }
    if (!fitted.current && people.length > 1) {
      fitted.current = true;
      api.map.fitBounds(api.L.latLngBounds(people.map(m => whereIs(m)!).map(p => [p.lat, p.lng] as [number, number])), { padding: [60, 60], maxZoom: 16 });
    }
  });

  function focus(m: Message) {
    const at = whereIs(m);
    if (at && api) api.map.setView([at.lat, at.lng], Math.max(api.map.getZoom(), 16), { animate: true });
  }

  async function locateMe() {
    try {
      const p = await currentPosition();
      setMe(p);
      api?.map.setView([p.coords.latitude, p.coords.longitude], Math.max(api.map.getZoom(), 15), { animate: true });
    } catch (error) { console.warn(geoErrorMessage(error as GeolocationPositionError)); }
  }

  const name = (m: Message) => m.user_id === userId ? 'Você' : shortName(m.author_name);
  return <>
    <div className="location-bar">
      <button type="button" className="icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={22} /></button>
      <h2>{isLive ? 'Localização em tempo real' : 'Localização'}</h2>
    </div>
    <div className="location-map">
      <div ref={mapEl} className="leaflet-host" />
      <div className="map-fabs">
        <MapZoom api={api} />
        {canLocate() && <button type="button" className="map-fab" onClick={() => void locateMe()} aria-label="Mostrar a minha localização"><LocateFixed size={22} /></button>}
      </div>
      {/* Modelos das fotos no mapa: o Leaflet copia o desenho daqui. */}
      {isLive && <span className="map-icon-models" aria-hidden>
        {people.map(m => <span key={m.id} ref={el => { icons.current.set(m.id, el?.firstElementChild as HTMLElement | null); }}>
          <LiveMarker message={m} active={isSharing(asPlace(m.location), now)} />
        </span>)}
      </span>}
    </div>
    <div className="location-options">
      {!isLive && (place.name || place.address) && <div className="location-place">
        <span className="location-icon pinned"><MapPin size={20} /></span>
        <span><strong>{place.name ?? place.address}</strong>{place.name && place.address && <small>{place.address}</small>}</span>
      </div>}
      {people.map(m => {
        const p = asPlace(m.location)!;
        const active = isSharing(p, now);
        const own = m.user_id === userId;
        return <div key={m.id} className="location-person">
          <button type="button" className="location-option" onClick={() => focus(m)}>
            <Avatar id={m.user_id} name={m.author_name} url={m.author_avatar} letter />
            <span>
              <strong>{name(m)}</strong>
              <small>{!isLive ? `Enviada ${whenLabel(m.created_at)}${p.accuracy ? ` · ${accuracyLabel(p.accuracy).toLowerCase()}` : ''}`
                : !active ? 'Localização em tempo real encerrada'
                : `${updatedLabel(m.live?.updated_at ?? m.created_at, now)} · ${remainingLabel(p.live_until!, now)}`}</small>
            </span>
          </button>
          {isLive && active && own
            ? <button type="button" className="live-action stop" onClick={() => onStop(m)}>Parar</button>
            : !own && <a className="map-directions" href={mapsUrl(whereIs(m)!.lat, whereIs(m)!.lng, apple)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir a localização de ${name(m)} no app de mapas`}>
              <Navigation size={20} />
            </a>}
        </div>;
      })}
      {!isLive && message.user_id === userId && <a className="location-option" href={mapsUrl(here.lat, here.lng, apple)} target="_blank" rel="noopener noreferrer">
        <span className="location-icon"><Navigation size={20} /></span>
        <span><strong>Abrir no app de mapas</strong></span>
      </a>}
    </div>
  </>;
}

