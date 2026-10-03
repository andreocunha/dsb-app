// Fotos de perfil passam pelo wsrv.nl: chegam já no tamanho em que aparecem, em WebP, e ficam no
// cache da CDN e do aparelho. Se o wsrv falhar, ele redireciona para a foto original (default).
const PROXY = 'https://wsrv.nl/';
const MAX_AGE = '30d';

/** Foto pública reduzida: quadrada e cortada (avatar) ou só limitada na largura (tela cheia). */
export function proxiedImage(url: string, size: number, fit: 'cover' | 'inside' = 'cover') {
  // blob:, data: e arquivos do próprio app não passam pelo proxy; links assinados (fotos privadas) nunca vão para fora.
  if (!/^https?:\/\//.test(url) || url.startsWith(PROXY) || url.includes('/object/sign/')) return url;
  const params = new URLSearchParams({ url, w: String(size), ...(fit === 'cover' ? { h: String(size), fit: 'cover' } : {}), we: '', output: 'webp', maxage: MAX_AGE, default: url });
  return `${PROXY}?${params}`;
}

const AVATAR = 160;
/** Avatares aparecem com até ~72px na tela: 160px cobre telas de densidade 2x e 3x. A do Google vem em 96px: pede maior. */
export const avatarImage = (url: string) => proxiedImage(googleSize(url, AVATAR), AVATAR);
/** Foto do Google vem em 96px; dá para pedir a mesma foto em outro tamanho. */
export const googleSize = (url: string, size: number) => /googleusercontent\.com\//.test(url) ? url.replace(/=s\d+(-c)?$/, `=s${size}$1`) : url;
