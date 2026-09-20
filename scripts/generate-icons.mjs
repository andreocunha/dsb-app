import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

// Ícones do PWA a partir do logo oficial (public/images/logo.png).
const logo = 'public/images/logo.png';
await mkdir('public/icons', { recursive: true });
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  await sharp(logo).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
// Maskable: o Android recorta as bordas, então o logo entra menor sobre o roxo da marca.
await sharp({ create: { width: 512, height: 512, channels: 3, background: '#422378' } })
  .composite([{ input: await sharp(logo).resize(320, 320).toBuffer(), gravity: 'center' }])
  .png().toFile('public/icons/maskable-512.png');

// O .ico exige PNG com canal alfa (RGBA).
const favicon = await sharp(logo).resize(48, 48).ensureAlpha().png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[6] = 48; header[7] = 48;
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(favicon.length, 14); header.writeUInt32LE(22, 18);
await writeFile('app/favicon.ico', Buffer.concat([header, favicon]));
