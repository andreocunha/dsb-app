// Regras de texto do chat, iguais às do WhatsApp. Funções puras, testadas em tests/chat-format.test.mjs.

export type Token =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'mono' | 'code'; text: string }
  | { type: 'mention'; text: string; id: string }
  | { type: 'bold' | 'italic' | 'strike'; children: Token[] };

const MARKS = { '*': 'bold', '_': 'italic', '~': 'strike' } as const;
const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const space = (c: string | undefined) => !c || /\s/.test(c);

/** Quem pode ser marcado com @: o nome como aparece depois do @ e a pessoa. */
export type Mentionable = { id: string; label: string };
const NONE: Mentionable[] = [];

/**
 * *negrito*, _itálico_, ~riscado~, `código` e ```bloco```, como no WhatsApp:
 * o marcador só vale colado no texto e fora de palavras (snake_case continua como está).
 * people: nomes que viram menção quando vêm depois de um @ ("@Andre Cunha").
 */
export function formatMessage(text: string, people: Mentionable[] = NONE): Token[] {
  const tokens: Token[] = [];
  const blocks = /```([\s\S]+?)```/g;
  let last = 0;
  for (const match of text.matchAll(blocks)) {
    tokens.push(...inlineCode(text.slice(last, match.index), people));
    tokens.push({ type: 'mono', text: match[1] });
    last = match.index + match[0].length;
  }
  tokens.push(...inlineCode(text.slice(last), people));
  return tokens;
}

function inlineCode(text: string, people: Mentionable[]): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    tokens.push(...marks(text.slice(last, match.index), people));
    tokens.push({ type: 'code', text: match[1] });
    last = match.index + match[0].length;
  }
  tokens.push(...marks(text.slice(last), people));
  return tokens;
}

function marks(text: string, people: Mentionable[]): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const mark = text[i] as keyof typeof MARKS;
    const end = MARKS[mark] && !wordChar(text[i - 1]) && !space(text[i + 1]) && text[i + 1] !== mark ? closing(text, i) : -1;
    if (end < 0) { plain += text[i++]; continue; }
    if (plain) { tokens.push(...mentions(plain, people)); plain = ''; }
    tokens.push({ type: MARKS[mark], children: marks(text.slice(i + 1, end), people) });
    i = end + 1;
  }
  if (plain) tokens.push(...mentions(plain, people));
  return tokens;
}

/** @Nome de alguém da lista vira menção; com nomes parecidos vale o mais longo ("@Ana Paula" antes de "@Ana"). */
function mentions(text: string, people: Mentionable[]): Token[] {
  if (!people.length || !text.includes('@')) return links(text);
  const tokens: Token[] = [];
  let last = 0;
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (i < last || wordChar(text[i - 1])) continue;
    const found = findMention(text, i + 1, people);
    if (!found) continue;
    tokens.push(...links(text.slice(last, i)));
    tokens.push({ type: 'mention', text: text.slice(i + 1, i + 1 + found.label.length), id: found.id });
    last = i + 1 + found.label.length;
  }
  tokens.push(...links(text.slice(last)));
  return tokens.filter(t => t.type !== 'text' || t.text);
}

function findMention(text: string, at: number, people: Mentionable[]) {
  let best: Mentionable | null = null;
  for (const person of people) {
    const { label } = person;
    if (!label || (best && label.length <= best.label.length)) continue;
    if (text.slice(at, at + label.length).toLocaleLowerCase('pt-BR') !== label.toLocaleLowerCase('pt-BR')) continue;
    if (!wordChar(text[at + label.length])) best = person;
  }
  return best;
}

/** Quem foi marcado no texto (sem repetir), na ordem em que aparece. Vai junto com a mensagem para o banco avisar. */
export function mentionedIds(text: string, people: Mentionable[]) {
  const ids = new Set<string>();
  const walk = (tokens: Token[]) => tokens.forEach(t => {
    if (t.type === 'mention') ids.add(t.id);
    else if ('children' in t) walk(t.children);
  });
  walk(formatMessage(text, people));
  return [...ids];
}

/**
 * O @ que está sendo digitado no cursor: de onde começa e o que já foi escrito depois dele.
 * Vale no começo do texto ou depois de um espaço, até três palavras, e some ao dar espaço no fim ou pular linha.
 */
export function mentionQuery(text: string, caret: number) {
  if (caret > text.length) return null;
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || caret - start > 41 || wordChar(before[start - 1]) || (start > 0 && !space(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (/\n|^\s|\s$|\s.*\s.*\s/.test(query)) return null;
  return { start, query };
}

/** Comparação sem acento e sem maiúsculas: "estev" acha "Estevão". */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');

function closing(text: string, open: number) {
  for (let j = open + 2; j < text.length; j++) {
    if (text[j] === '\n') return -1;
    if (text[j] === text[open] && !space(text[j - 1]) && !wordChar(text[j + 1])) return j;
  }
  return -1;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;

function links(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    // Pontuação no fim ("veja www.dsb.app.br.") não faz parte do link.
    const url = match[0].replace(/[.,!?;:)\]'"]+$/, '');
    if (match.index > last) tokens.push({ type: 'text', text: text.slice(last, match.index) });
    tokens.push({ type: 'link', text: url, href: /^https?:/i.test(url) ? url : `https://${url}` });
    last = match.index + url.length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
}

/** De 1 a 3 emojis sem mais nada: o WhatsApp mostra grande e sem balão. Devolve quantos são, ou 0. */
export function jumboEmoji(text: string | null) {
  if (!text || text.length > 40) return 0;
  const graphemes = [...new Intl.Segmenter().segment(text.replace(/\s+/g, ''))].map(s => s.segment);
  if (!graphemes.length || graphemes.length > 3) return 0;
  return graphemes.every(g => /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(g)) ? graphemes.length : 0;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Selo de data do chat: Hoje, Ontem, o dia da semana na última semana, senão dd/mm/aaaa. */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days > 1 && days < 7) {
    const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
    return weekday[0].toUpperCase() + weekday.slice(1);
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Horário na lista de conversas: a hora se foi hoje, senão Ontem, dia da semana ou data. */
export function listTime(iso: string, now = new Date()) {
  const day = dayLabel(iso, now);
  return day === 'Hoje' ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : day;
}

/** "hoje às 14:32", como no topo do visualizador de mídia. */
export function whenLabel(iso: string, now = new Date()) {
  const day = dayLabel(iso, now);
  const time = new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${/^\d/.test(day) ? day : day.toLowerCase()} às ${time}`;
}

/** Mensagens longas mostram o começo e "Ler mais", sem cortar no meio de uma palavra. */
export const READ_MORE_LIMIT = 700;
export function preview(text: string, limit = READ_MORE_LIMIT) {
  if (text.length <= limit) return null;
  const cut = text.slice(0, limit - 150);
  const space = cut.lastIndexOf(' ');
  return (space > cut.length - 40 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** Cor estável para o nome de cada pessoa no grupo (as cores ficam em theme.css). */
export const NAME_COLORS = 12;
export const nameColor = (id: string) => [...id].reduce((sum, c) => sum * 31 + c.charCodeAt(0) >>> 0, 7) % NAME_COLORS;
