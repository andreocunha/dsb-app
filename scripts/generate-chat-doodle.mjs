// Gera public/images/chat-doodle.svg: o papel de parede do chat, no estilo do WhatsApp
// (desenhos de linha densos, de vários tamanhos, com bolinhas e brilhos entre eles).
// Os ícones são do lucide (licença ISC). O resultado é determinístico: rodar de novo gera o mesmo arquivo.
//   node scripts/generate-chat-doodle.mjs
import { writeFileSync } from 'node:fs';

const TILE = 700;
const STROKE = 1.4; // espessura na tela, em px

const BIG = ['sailboat', 'trophy', 'tree-palm', 'ferris-wheel', 'guitar', 'rocket', 'solar-panel', 'cake', 'camera', 'gift', 'bike', 'drum', 'ship', 'headphones', 'gamepad-2', 'globe', 'life-buoy', 'car'];
const MEDIUM = [
  'sun', 'sailboat', 'ship', 'waves-horizontal', 'trophy', 'medal', 'flag', 'battery-charging', 'anchor', 'cloud', 'cloud-sun', 'timer',
  'face-slightly-smiling', 'fish', 'life-buoy', 'camera', 'music', 'coffee', 'gift', 'umbrella', 'leaf', 'flower', 'bike', 'car', 'globe',
  'map-pin', 'compass', 'bell', 'key', 'book', 'headphones', 'gamepad-2', 'pizza', 'ice-cream-cone', 'shell', 'glasses',
  'thumbs-up', 'party-popper', 'sprout', 'popcorn', 'lollipop', 'mountain', 'drum', 'volleyball', 'plug-zap', 'binoculars',
  'feather', 'cherry', 'citrus', 'sandwich', 'hand-metal', 'wind', 'cable-car', 'kayak', 'solar-panel', 'tree-palm',
];
const SMALL = ['sparkles', 'star', 'heart', 'moon', 'zap', 'droplet', 'music', 'face-slightly-smiling', 'cloud', 'leaf'];

// Números pseudoaleatórios com semente fixa.
let seed = 20260930;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (min, max) => min + random() * (max - min);
const pick = list => list[Math.floor(random() * list.length)];

const icons = new Map();
async function icon(name) {
  if (!icons.has(name)) {
    const { __iconData } = await import(new URL(`../node_modules/lucide-react/dist/esm/icons/${name}.mjs`, import.meta.url).href);
    const body = __iconData.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
    icons.set(name, `<g id="${name}">${body}</g>`);
  }
  return name;
}

// Distância com a volta do bloco (o que sai por um lado entra pelo outro).
const placed = [];
function wrapDistance(a, b) {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return Math.hypot(Math.min(dx, TILE - dx), Math.min(dy, TILE - dy));
}
function place(radius, gap, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const spot = { x: between(0, TILE), y: between(0, TILE), r: radius };
    if (placed.every(other => wrapDistance(spot, other) > spot.r + other.r + gap)) { placed.push(spot); return spot; }
  }
  return null;
}
// Repete o desenho do outro lado quando ele cruza a borda, para o bloco emendar sem corte.
function copies(spot, draw) {
  const out = [];
  for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) {
    const x = spot.x + ox, y = spot.y + oy;
    if (x + spot.r < 0 || x - spot.r > TILE || y + spot.r < 0 || y - spot.r > TILE) continue;
    out.push(draw(x.toFixed(1), y.toFixed(1)));
  }
  return out.join('');
}

const shapes = [];
async function addIcon(names, count, minSize, maxSize, gap, maxAngle) {
  for (let i = 0; i < count; i++) {
    const size = between(minSize, maxSize);
    const spot = place(size * .5, gap);
    if (!spot) continue;
    const name = await icon(pick(names));
    const scale = size / 24, angle = between(-maxAngle, maxAngle).toFixed(0);
    shapes.push(copies(spot, (x, y) =>
      `<use href="#${name}" stroke-width="${(STROKE / scale).toFixed(3)}" transform="translate(${x} ${y}) rotate(${angle}) scale(${scale.toFixed(3)}) translate(-12 -12)"/>`));
  }
}

await addIcon(BIG, 12, 84, 112, 5, 12);
await addIcon(MEDIUM, 120, 40, 62, 4, 20);
await addIcon(SMALL, 90, 20, 28, 4, 25);
// Enchimento: bolinhas, tracinhos e brilhos pequenos em todo vão que sobrar, como no WhatsApp.
for (let i = 0; i < 900; i++) {
  const kind = random();
  if (kind < .7) {
    const r = between(3, 6), spot = place(r + 1, 5);
    if (spot) shapes.push(copies(spot, (x, y) => `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>`));
  } else if (kind < .85) {
    const spot = place(8, 5), angle = between(-40, 40).toFixed(0);
    if (spot) shapes.push(copies(spot, (x, y) => `<rect x="-7" y="-2.5" width="14" height="5" rx="2.5" transform="translate(${x} ${y}) rotate(${angle})"/>`));
  } else {
    const spot = place(7, 5), s = between(5, 7.5);
    if (spot) shapes.push(copies(spot, (x, y) => `<path d="M0 ${-s}Q0 0 ${s} 0Q0 0 0 ${s}Q0 0 ${-s} 0Q0 0 0 ${-s}z" transform="translate(${x} ${y})"/>`));
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
<!-- Papel de parede do chat, gerado por scripts/generate-chat-doodle.mjs. Usado como máscara: a cor vem do token wa-doodle. Ícones: lucide (ISC). -->
<defs>${[...icons.values()].join('')}</defs>
<g fill="none" stroke="#000" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${shapes.join('')}</g>
</svg>
`;
writeFileSync(new URL('../public/images/chat-doodle.svg', import.meta.url), svg);
console.log(`chat-doodle.svg: ${placed.length} desenhos, ${(svg.length / 1024).toFixed(0)} KB`);
