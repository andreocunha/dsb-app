import type { MetadataRoute } from 'next';
export const dynamic = 'force-static';
export default function manifest(): MetadataRoute.Manifest {
  return { id: '/', name: 'DSB — Desafio Solar Brasil', short_name: 'DSB', description: 'Seu lugar no Desafio Solar Brasil.', lang: 'pt-BR', start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f7fa', theme_color: '#422c70', icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ] };
}
