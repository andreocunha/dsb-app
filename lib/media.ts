// Mídias do chat: a miniatura é gerada no aparelho, então o chat baixa só ~30KB por imagem/vídeo
// e o arquivo original só quando alguém toca para abrir.
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // limite do bucket no plano gratuito do Supabase
const THUMB_SIZE = 480;

export type Thumbnail = { blob: Blob; width: number; height: number };

/** Nunca trava o envio: se a miniatura não sair em 5s (ex.: aba em segundo plano), segue sem ela. */
export function makeThumbnail(file: File): Promise<Thumbnail | null> {
  return Promise.race([thumbnail(file), new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))]);
}

async function thumbnail(file: File): Promise<Thumbnail | null> {
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file);
      const thumb = await draw(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return thumb;
    }
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try {
        const video = await videoFrame(url);
        return await draw(video, video.videoWidth, video.videoHeight);
      } finally { URL.revokeObjectURL(url); }
    }
  } catch { /* Sem miniatura: o chat mostra o arquivo como anexo. */ }
  return null;
}

async function draw(source: CanvasImageSource, width: number, height: number): Promise<Thumbnail | null> {
  if (!width || !height) return null;
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  return blob && { blob, width, height };
}

function videoFrame(url: string) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.5, (video.duration || 1) / 2); };
    video.onseeked = () => resolve(video);
    video.onerror = reject;
    video.src = url;
  });
}

/** Nome seguro para o storage (sem acentos, espaços ou símbolos). */
export const storageName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'arquivo';

export function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
