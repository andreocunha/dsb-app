/** Edite os links do evento aqui, sem alterar componentes. */
export const eventConfig = {
  trackingUrl: 'https://dsb-rastreio.vercel.app/',
  // Aceita youtube.com/watch?v=..., youtube.com/live/... ou youtu.be/...
  youtubeUrl: process.env.NEXT_PUBLIC_YOUTUBE_LIVE_URL || 'https://www.youtube.com/watch?v=rFZHOHl-L8A', // live de teste
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
