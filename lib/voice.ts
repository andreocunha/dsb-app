// Gravação de mensagens de voz, como no WhatsApp: MediaRecorder para o áudio e um AnalyserNode
// medindo o volume a cada 100ms (é o que desenha a onda ao vivo e a do balão).

export type Recording = { blob: Blob; type: string; durationMs: number; waveform: number[] };

// MP4 com AAC toca em todos os aparelhos (iPhone inclusive); os outros ficam de reserva, nessa ordem.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
export const MIN_VOICE_MS = 1000;
export const WAVE_BARS = 60;

export const canRecord = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Reduz as medições para `bars` barras de 0 a 100, com o pico de cada trecho (a onda fica viva mesmo em áudios longos). */
export function toWaveform(levels: number[], bars = WAVE_BARS) {
  if (!levels.length) return Array<number>(bars).fill(8);
  const peak = Math.max(...levels, 1);
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor(i * levels.length / bars), to = Math.max(from + 1, Math.floor((i + 1) * levels.length / bars));
    const value = Math.max(...levels.slice(from, to));
    return Math.max(6, Math.round(value / peak * 100));
  });
}

/** "0:07", "1:23". */
export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export class VoiceRecorder {
  levels: number[] = [];
  private chunks: Blob[] = [];
  private startedAt = performance.now();
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private timer: ReturnType<typeof setInterval>;
  private stream: MediaStream;
  private recorder: MediaRecorder;
  private context: AudioContext;

  private constructor(stream: MediaStream, recorder: MediaRecorder, context: AudioContext, analyser: AnalyserNode, onLevel: (level: number) => void) {
    this.stream = stream;
    this.recorder = recorder;
    this.context = context;
    recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    const samples = new Uint8Array(analyser.fftSize);
    this.timer = setInterval(() => {
      if (this.pausedAt !== null) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      // Raiz quadrada: fala baixa ainda aparece na onda, grito não estoura.
      const level = Math.min(100, Math.round(Math.sqrt(Math.sqrt(sum / samples.length)) * 160));
      this.levels.push(level);
      onLevel(level);
    }, 100);
  }

  /** Pede o microfone e começa a gravar. Lança erro se a pessoa negar a permissão. */
  static async start(onLevel: (level: number) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const type = TYPES.find(t => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48_000 } : undefined);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const voice = new VoiceRecorder(stream, recorder, context, analyser, onLevel);
    recorder.start(250);
    return voice;
  }

  get elapsed() {
    return (this.pausedAt ?? performance.now()) - this.startedAt - this.pausedTotal;
  }
  get paused() { return this.pausedAt !== null; }
  get type() { return this.recorder.mimeType || 'audio/webm'; }

  pause() {
    if (this.pausedAt !== null || this.recorder.state !== 'recording') return;
    this.recorder.pause();
    this.recorder.requestData();
    this.pausedAt = performance.now();
  }

  resume() {
    if (this.pausedAt === null) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = null;
    this.recorder.resume();
  }

  /** O que já foi gravado, para ouvir antes de enviar (com a gravação pausada). */
  preview() {
    return new Blob(this.chunks, { type: this.type });
  }

  async stop(): Promise<Recording> {
    const durationMs = Math.round(this.elapsed);
    if (this.recorder.state !== 'inactive') {
      const done = new Promise<void>(resolve => { this.recorder.onstop = () => resolve(); });
      this.recorder.stop();
      await done;
    }
    this.release();
    return { blob: new Blob(this.chunks, { type: this.type }), type: this.type, durationMs, waveform: toWaveform(this.levels) };
  }

  cancel() {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release() {
    clearInterval(this.timer);
    this.stream.getTracks().forEach(track => track.stop());
    void this.context.close().catch(() => {});
  }
}
