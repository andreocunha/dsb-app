'use client';
import { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, Pause, Play } from 'lucide-react';
import { formatDuration } from '@/lib/voice';
import { Avatar } from '../ui';
import { useFileUrl } from './files';
import type { Message } from './types';

const BARS = 40;
const SPEEDS = [1, 1.5, 2];
// Um áudio tocando por vez, e a velocidade escolhida vale para os próximos (como no WhatsApp).
let playing: HTMLAudioElement | null = null;
let speed = 1;
// Quem pode ser tocado em seguida: ao terminar um áudio, o próximo da sequência começa sozinho.
const players = new Map<number, () => void>();

/** Reamostra a forma de onda gravada (até 100 pontos) para as barras do balão. */
function bars(waveform: number[] | null) {
  if (!waveform?.length) return Array.from({ length: BARS }, (_, i) => 20 + Math.round(18 * Math.abs(Math.sin(i * 1.7))));
  return Array.from({ length: BARS }, (_, i) => waveform[Math.min(waveform.length - 1, Math.floor(i * waveform.length / BARS))]);
}

/**
 * Mensagem de voz: play, onda com a bolinha de posição, duração e a foto de quem gravou com o
 * microfone (verde = você ainda não ouviu; azul = ouvido). Enquanto toca, a foto vira a velocidade.
 * Arquivo de áudio comum (sem gravação no chat) mostra o fone laranja no lugar da foto.
 */
export function VoiceMessage({ message, own, played, nextId, onPlayed }: {
  message: Message; own: boolean; played: 'new' | 'sent' | 'played'; nextId: number | null; onPlayed: (message: Message) => void;
}) {
  const url = useFileUrl(message.conversation_id, message.pending ? null : message.file_path);
  const src = message.localUrl ?? url;
  const audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0);
  const [state, setState] = useState<{ playing: boolean; started: boolean; position: number; rate: number; loadedMs: number | null }>(
    { playing: false, started: false, position: 0, rate: speed, loadedMs: null });
  const voice = message.duration_ms !== null;
  const totalMs = message.duration_ms ?? state.loadedMs ?? 0;
  const shape = bars(message.waveform);

  function tick() {
    const el = audio.current;
    if (!el) return;
    setState(s => ({ ...s, position: el.currentTime * 1000 }));
    if (!el.paused) frame.current = requestAnimationFrame(tick);
  }

  function ensureAudio() {
    if (audio.current || !src) return audio.current;
    const el = new Audio(src);
    el.preload = 'auto';
    el.onloadedmetadata = () => { if (Number.isFinite(el.duration)) setState(s => ({ ...s, loadedMs: el.duration * 1000 })); };
    // Além do quadro a quadro (suave), o timeupdate segura o tempo quando a tela não está desenhando.
    el.ontimeupdate = () => setState(s => ({ ...s, position: el.currentTime * 1000 }));
    el.onplay = () => { setState(s => ({ ...s, playing: true, started: true })); frame.current = requestAnimationFrame(tick); };
    el.onpause = () => { cancelAnimationFrame(frame.current); setState(s => ({ ...s, playing: false })); };
    el.onended = () => {
      cancelAnimationFrame(frame.current);
      setState(s => ({ ...s, playing: false, started: false, position: 0 }));
      if (playing === el) playing = null;
      if (nextId !== null) players.get(nextId)?.();
    };
    audio.current = el;
    return el;
  }

  function play() {
    const el = ensureAudio();
    if (!el) return;
    if (playing && playing !== el) playing.pause();
    playing = el;
    el.playbackRate = speed;
    setState(s => ({ ...s, rate: speed }));
    void el.play().catch(() => {});
    if (!own && played === 'new') onPlayed(message);
  }

  function toggle() {
    if (audio.current && !audio.current.paused) audio.current.pause(); else play();
  }

  function cycleSpeed() {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    if (audio.current) audio.current.playbackRate = speed;
    setState(s => ({ ...s, rate: speed }));
  }

  function seek(ms: number) {
    const el = ensureAudio();
    if (!el) return;
    el.currentTime = ms / 1000;
    setState(s => ({ ...s, position: ms, started: true }));
  }

  useEffect(() => {
    players.set(message.id, play);
    return () => { players.delete(message.id); };
  });
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (audio.current) { audio.current.pause(); if (playing === audio.current) playing = null; }
  }, []);

  const progress = totalMs ? Math.min(1, state.position / totalMs) : 0;
  const shown = state.started ? state.position : totalMs;
  const badge = <span className={`voice-mic ${played}`}>{voice ? <Mic size={14} strokeWidth={2.6} /> : <Headphones size={14} />}</span>;

  return <div className={`voice ${own ? 'own' : 'in'} ${played}`}>
    <span className="voice-side">
      {state.started
        ? <button type="button" className="voice-speed" onClick={cycleSpeed} aria-label={`Velocidade ${state.rate}x. Toque para mudar`}>{String(state.rate).replace('.', ',')}x</button>
        : voice ? <span className="voice-avatar"><Avatar id={message.user_id} name={message.author_name} url={message.author_avatar} />{badge}</span>
        : <span className="voice-file"><Headphones size={24} /></span>}
    </span>
    <button type="button" className="voice-play" onClick={toggle} disabled={!src} aria-label={state.playing ? 'Pausar' : 'Ouvir mensagem de voz'}>
      {message.pending ? <span className="spinner" /> : state.playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
    </button>
    <span className="voice-track">
      <span className="voice-wave" aria-hidden>
        {shape.map((h, i) => <i key={i} className={i / BARS < progress ? 'on' : ''} style={{ height: `${Math.max(12, h)}%` }} />)}
        <b className="voice-dot" style={{ left: `${progress * 100}%` }} />
      </span>
      <input type="range" className="voice-seek" min={0} max={Math.max(1, Math.round(totalMs))} step={10} value={Math.round(state.position)}
        onChange={e => seek(Number(e.target.value))} aria-label="Posição do áudio" disabled={!src} />
      <span className="voice-time">{formatDuration(shown)}</span>
    </span>
  </div>;
}
