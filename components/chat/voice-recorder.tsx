'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronUp, Lock, Mic, Pause, Play, Trash2 } from 'lucide-react';
import { canRecord, formatDuration, MIN_VOICE_MS, VoiceRecorder, type Recording } from '@/lib/voice';

type Mode = 'idle' | 'hold' | 'locked';
const CANCEL_AT = 110; // px para a esquerda
const LOCK_AT = 70; // px para cima
const LIVE_BARS = 48;

/**
 * Gravação de mensagem de voz, como no WhatsApp.
 * Celular: segurar o microfone grava; soltar envia; deslizar para a esquerda cancela; para cima trava.
 * Travada (ou no computador, com um clique): lixeira, tempo, onda ao vivo, pausar/ouvir e enviar.
 */
export function useVoiceRecorder({ onSend, onActivity, onError }: {
  onSend: (recording: Recording) => void; onActivity: () => void; onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const recorder = useRef<VoiceRecorder | null>(null);
  const wanted = useRef<Mode>('idle');
  const origin = useRef({ x: 0, y: 0, at: 0 });

  // Relógio da gravação e o "gravando áudio…" para a outra pessoa.
  useEffect(() => {
    if (mode === 'idle') return;
    const clock = setInterval(() => setElapsed(recorder.current?.elapsed ?? 0), 200);
    onActivity();
    const activity = setInterval(onActivity, 3000);
    return () => { clearInterval(clock); clearInterval(activity); };
  }, [mode, onActivity]);

  function reset() {
    recorder.current = null;
    wanted.current = 'idle';
    setMode('idle');
    setElapsed(0);
    setLevels([]);
    setPaused(false);
    setDrag({ x: 0, y: 0 });
  }

  async function begin(next: Mode) {
    if (!canRecord()) { onError('Este navegador não grava áudio.'); return; }
    wanted.current = next;
    setMode(next);
    try {
      const started = await VoiceRecorder.start(level => setLevels(current => [...current.slice(-199), level]));
      // Soltou o dedo enquanto o sistema pedia permissão: não grava nada.
      if (wanted.current === 'idle') { started.cancel(); return; }
      recorder.current = started;
      navigator.vibrate?.(25);
    } catch {
      reset();
      onError('Não deu para usar o microfone. Libere o acesso ao microfone para gravar.');
    }
  }

  function cancel() {
    recorder.current?.cancel();
    reset();
  }

  async function finish() {
    const current = recorder.current;
    if (!current) { reset(); return; }
    recorder.current = null;
    const recording = await current.stop();
    reset();
    // Como no WhatsApp, áudio de menos de 1 segundo é descartado.
    if (recording.durationMs >= MIN_VOICE_MS && recording.blob.size) onSend(recording);
  }

  function togglePause() {
    const current = recorder.current;
    if (!current) return;
    if (current.paused) current.resume(); else current.pause();
    setPaused(current.paused);
  }

  // Microfone no celular: segurar, deslizar e soltar.
  const holdHandlers = {
    onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ponteiro já saiu */ }
      origin.current = { x: e.clientX, y: e.clientY, at: performance.now() };
      void begin('hold');
    },
    onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
      if (wanted.current !== 'hold') return;
      const x = Math.min(0, e.clientX - origin.current.x), y = Math.min(0, e.clientY - origin.current.y);
      if (-y > LOCK_AT) { wanted.current = 'locked'; setMode('locked'); setDrag({ x: 0, y: 0 }); navigator.vibrate?.(15); return; }
      if (-x > CANCEL_AT) { cancel(); navigator.vibrate?.(15); return; }
      setDrag(Math.abs(x) > Math.abs(y) ? { x, y: 0 } : { x: 0, y });
    },
    onPointerUp() {
      if (wanted.current !== 'hold') return;
      // Toque rápido: o WhatsApp explica como gravar.
      if (performance.now() - origin.current.at < 350) { cancel(); onError('Segure para gravar e solte para enviar.'); return; }
      void finish();
    },
    onPointerCancel() { if (wanted.current === 'hold') cancel(); },
  };

  return { mode, elapsed, levels, paused, drag, begin, cancel, finish, togglePause, holdHandlers, preview: () => recorder.current?.preview() ?? null };
}

export type VoiceRecorderState = ReturnType<typeof useVoiceRecorder>;

/** O que aparece no lugar do campo de digitar enquanto grava. */
export function RecordingBar({ voice }: { voice: VoiceRecorderState }) {
  if (voice.mode === 'hold') return <div className="recording hold">
    <span className="recording-time"><Mic size={22} className="recording-dot" />{formatDuration(voice.elapsed)}</span>
    <span className="recording-slide" style={{ transform: `translateX(${voice.drag.x}px)`, opacity: 1 + voice.drag.x / CANCEL_AT }}>
      <ChevronLeft size={18} /> Deslize para cancelar
    </span>
  </div>;
  return <LockedBar voice={voice} />;
}

function LockedBar({ voice }: { voice: VoiceRecorderState }) {
  const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const [preview, setPreview] = useState({ playing: false, position: 0 });
  const live = voice.levels.slice(-LIVE_BARS);

  // Pausado: dá para ouvir o que já foi gravado antes de mandar.
  function togglePreview() {
    const current = player.current;
    if (current) { if (current.audio.paused) void current.audio.play(); else current.audio.pause(); return; }
    const blob = voice.preview();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.ontimeupdate = () => setPreview(p => ({ ...p, position: audio.currentTime * 1000 }));
    audio.onplay = () => setPreview(p => ({ ...p, playing: true }));
    audio.onpause = audio.onended = () => setPreview(p => ({ ...p, playing: false }));
    player.current = { audio, url };
    void audio.play();
  }

  function stopPreview() {
    const current = player.current;
    if (!current) return;
    current.audio.pause();
    URL.revokeObjectURL(current.url);
    player.current = null;
    setPreview({ playing: false, position: 0 });
  }

  useEffect(() => () => {
    const current = player.current;
    if (current) { current.audio.pause(); URL.revokeObjectURL(current.url); }
  }, []);

  return <div className="recording locked">
    <button type="button" className="compose-icon recording-trash" onClick={() => { stopPreview(); voice.cancel(); }} aria-label="Apagar gravação"><Trash2 size={22} /></button>
    {voice.paused
      ? <button type="button" className="compose-icon recording-preview" onClick={togglePreview} aria-label={preview.playing ? 'Pausar' : 'Ouvir o que foi gravado'}>
          {preview.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
      : <span className="recording-time"><i className="recording-red" />{formatDuration(voice.elapsed)}</span>}
    <span className={`recording-wave ${voice.paused ? 'paused' : ''}`} aria-hidden>
      {(voice.paused ? squeeze(voice.levels) : live).map((level, i) => <i key={i} style={{ height: `${Math.max(10, level)}%` }} />)}
    </span>
    {voice.paused && <span className="recording-time quiet">{formatDuration(preview.position || voice.elapsed)}</span>}
    <button type="button" className={`compose-icon recording-pause ${voice.paused ? 'resume' : ''}`} onClick={() => { stopPreview(); voice.togglePause(); }}
      aria-label={voice.paused ? 'Continuar gravando' : 'Pausar gravação'}>
      {voice.paused ? <Mic size={22} /> : <Pause size={22} />}
    </button>
  </div>;
}

/** Com a gravação pausada, a onda inteira cabe na barra (como no WhatsApp). */
function squeeze(levels: number[]) {
  if (levels.length <= LIVE_BARS) return levels;
  return Array.from({ length: LIVE_BARS }, (_, i) => Math.max(...levels.slice(Math.floor(i * levels.length / LIVE_BARS), Math.floor((i + 1) * levels.length / LIVE_BARS))));
}

/** O cadeado que aparece acima do microfone enquanto segura (deslize para cima para travar). */
export function LockHint({ dragY }: { dragY: number }) {
  return <span className="recording-lock" style={{ transform: `translateY(${Math.max(dragY, -LOCK_AT) / 2}px)` }} aria-hidden>
    <Lock size={18} /><ChevronUp size={16} />
  </span>;
}
