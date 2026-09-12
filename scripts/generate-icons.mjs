import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
// Native vector artwork. Keep colors aligned with app/theme.css.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#422c70"/><g fill="none" stroke="#efc34b" stroke-width="18" stroke-linecap="round"><circle cx="256" cy="203" r="60"/><path d="M256 105V85M186 133l-15-15M158 203h-21M326 133l15-15M354 203h21"/><path d="M145 293h222l-34 42H180z" fill="#efc34b" stroke-linejoin="round"/><path d="M151 371q26-18 52 0t52 0t52 0t52 0"/></g></svg>`;
await mkdir('public/icons', { recursive: true });
await writeFile('public/icon.svg', svg);
for (const [name, size] of [['icon-192',192],['icon-512',512],['apple-touch-icon',180]]) await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icons/${name}.png`);
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#422c70"/><g transform="translate(51.2 51.2) scale(.8)">${svg.replace(/<svg[^>]*>|<\/svg>/g,'')}</g></svg>`;
await sharp(Buffer.from(maskable)).png().toFile('public/icons/maskable-512.png');
const png = await sharp(Buffer.from(svg)).resize(48,48).png().toBuffer();
const header = Buffer.alloc(22); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header[6]=48; header[7]=48; header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
await writeFile('app/favicon.ico',Buffer.concat([header,png]));
