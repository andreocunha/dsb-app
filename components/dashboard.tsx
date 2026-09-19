'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock3, Maximize2, PictureInPicture2, Radio, Trophy, X } from 'lucide-react';
import { teams, races } from '@/lib/mock-data';
import { raceDate, raceTime, useStartedCount } from '@/lib/races';
import { eventConfig, youtubeEmbedUrl } from '@/lib/event-config';
import { TeamBadge } from './ui';

// A live fica em tela cheia sobre o mapa ou num mini player (PiP) no canto.
type LiveMode = 'off' | 'full' | 'pip';

export function Dashboard() {
  const [results, setResults] = useState(false);
  const [live, setLive] = useState<LiveMode>('off');
  const started = useStartedCount();
  const race = races[Math.min(started, races.length - 1)];

  return (
    <div className={`home fill ${live === 'pip' ? 'has-pip' : ''}`}>
      <div className="home-hud">
        <section className="hud-card race-card" aria-label="Próxima prova">
          <span className="eyebrow">{started >= races.length ? 'Última prova' : 'Próxima prova'} · Prova {race.number}</span>
          <h1>{race.name}</h1>
          <p>
            <span><CalendarDays size={14} /><time dateTime={race.start}>{raceDate(race)}</time></span>
            <span><Clock3 size={14} /><time dateTime={race.start}>{raceTime(race)}</time></span>
          </p>
          <div className="hud-actions">
            <button aria-pressed={results} aria-controls="results-panel" onClick={() => setResults(!results)}><Trophy size={16} /> Resultado</button>
            <button aria-pressed={live !== 'off'} onClick={() => setLive(live === 'off' ? 'full' : 'off')}><Radio size={16} /> Live</button>
          </div>
        </section>
        {results && <Results onClose={() => setResults(false)} />}
      </div>

      <div className="home-stage">
        <iframe
          className="map-frame"
          src={eventConfig.trackingUrl}
          title="Rastreamento das embarcações do Desafio Solar Brasil"
          allow="fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {live !== 'off' && <Live mode={live} raceName={race.name} setMode={setLive} />}
      </div>
    </div>
  );
}

function Results({ onClose }: { onClose: () => void }) {
  return (
    <section id="results-panel" className="hud-card results-card" aria-label="Classificação geral">
      <div className="hud-card-title"><h2>Classificação geral</h2><button className="icon-button" onClick={onClose} aria-label="Fechar classificação"><X size={18} /></button></div>
      <ol className="results">
        {[...teams].sort((a, b) => b.points - a.points).map((team, index) => (
          <li key={team.id}>
            <span className="position">{index + 1}</span>
            <TeamBadge team={team} small />
            <span className="results-team"><strong>{team.name}</strong><small>{team.university.split(' · ')[0]} · Tier {team.tier}</small></span>
            <strong>{team.points}<small> pts</small></strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Box = { x: number; y: number; w: number };
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function Live({ mode, raceName, setMode }: { mode: Exclude<LiveMode, 'off'>; raceName: string; setMode: (mode: LiveMode) => void }) {
  const embedUrl = youtubeEmbedUrl(eventConfig.youtubeUrl);
  const ref = useRef<HTMLElement>(null);
  // Posição e largura do mini player dentro do mapa; null = canto padrão do CSS.
  const [box, setBox] = useState<Box | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const reset = () => setBox(null);
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);

  // Arrastar pela barra move o player; arrastar a alça do canto muda o tamanho.
  function startGesture(event: React.PointerEvent, kind: 'move' | 'resize') {
    if (mode !== 'pip' || event.button !== 0 || (kind === 'move' && (event.target as HTMLElement).closest('button'))) return;
    const element = ref.current!;
    const stage = element.parentElement!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const start = { px: event.clientX, py: event.clientY, x: rect.left - stage.left, y: rect.top - stage.top, w: rect.width, h: rect.height };
    const barHeight = start.h - start.w * 9 / 16;
    const minWidth = stage.width < 600 ? 160 : 240;
    event.preventDefault();
    // Captura o ponteiro para receber os eventos mesmo passando sobre os iframes.
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setMoving(true);
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - start.px, dy = e.clientY - start.py;
      if (kind === 'move') {
        setBox({ w: start.w, x: clamp(start.x + dx, 0, stage.width - start.w), y: clamp(start.y + dy, 0, stage.height - start.h) });
        return;
      }
      // Alça no canto superior esquerdo: o canto inferior direito fica ancorado.
      const grow = Math.abs(dx) > Math.abs(dy * 16 / 9) ? -dx : -dy * 16 / 9;
      const w = clamp(start.w + grow, minWidth, Math.min(stage.width, (stage.height - barHeight) * 16 / 9));
      const h = barHeight + w * 9 / 16;
      setBox({ w, x: clamp(start.x + start.w - w, 0, stage.width - w), y: clamp(start.y + start.h - h, 0, stage.height - h) });
    };
    const onUp = () => { setMoving(false); handle.removeEventListener('pointermove', onMove); handle.removeEventListener('lostpointercapture', onUp); };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('lostpointercapture', onUp);
  }

  const style = mode === 'pip' && box ? { left: box.x, top: box.y, bottom: 'auto', width: box.w } : undefined;
  // O mesmo iframe é mantido entre os modos: trocar para PiP não reinicia o vídeo.
  return (
    <section ref={ref} className={`live live-${mode} ${moving ? 'moving' : ''}`} style={style} aria-label="Transmissão ao vivo">
      <div className="live-bar" onPointerDown={event => startGesture(event, 'move')}>
        <span className="live-label"><span className="live-dot" /> Ao vivo<span className="live-race"> · {raceName}</span></span>
        {mode === 'full'
          ? <button onClick={() => setMode('pip')} aria-label="Assistir em mini player sobre o mapa"><PictureInPicture2 size={16} /><span>Mini player</span></button>
          : <button onClick={() => setMode('full')} aria-label="Expandir transmissão"><Maximize2 size={15} /></button>}
        <button onClick={() => setMode('off')} aria-label="Fechar transmissão"><X size={17} /></button>
      </div>
      <div className="live-video">
        {embedUrl ? (
          <iframe
            src={`${embedUrl}&autoplay=1`}
            title="Transmissão do Desafio Solar Brasil no YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="live-waiting"><Radio size={28} /><p>A transmissão começa em breve.</p></div>
        )}
      </div>
      {mode === 'pip' && <span className="live-resize" onPointerDown={event => startGesture(event, 'resize')} aria-hidden="true" />}
    </section>
  );
}
