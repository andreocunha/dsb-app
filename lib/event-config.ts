/** Edite os links do evento aqui, sem alterar componentes. */
export const eventConfig = {
  // Para testar com o mapa rodando no computador: NEXT_PUBLIC_TRACKING_URL=http://localhost:3001/ (em .env.development.local)
  trackingUrl: process.env.NEXT_PUBLIC_TRACKING_URL || 'https://dsb-rastreio.vercel.app/',
  // Aceita youtube.com/watch?v=..., youtube.com/live/... ou youtu.be/...
  // Sem link definido, a aba Live mostra "a transmissão começa em breve".
  // Para testar com uma live qualquer: NEXT_PUBLIC_YOUTUBE_LIVE_URL=https://www.youtube.com/watch?v=rFZHOHl-L8A
  youtubeUrl: process.env.NEXT_PUBLIC_YOUTUBE_LIVE_URL || '',
};
export function youtubeEmbedUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      id = url.searchParams.get('v');
      if (!id && /^\/(live|embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2];
    }
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0` : null;
  } catch { return null; }
}
