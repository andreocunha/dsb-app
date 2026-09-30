// Regras de texto do chat, iguais às do WhatsApp. Funções puras, testadas em tests/chat-format.test.mjs.

export type Token =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'mono' | 'code'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: Token[] };

const MARKS = { '*': 'bold', '_': 'italic', '~': 'strike' } as const;
const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const space = (c: string | undefined) => !c || /\s/.test(c);

/**
 * *negrito*, _itálico_, ~riscado~, `código` e ```bloco```, como no WhatsApp:
 * o marcador só vale colado no texto e fora de palavras (snake_case continua como está).
 */
export function formatMessage(text: string): Token[] {
  const tokens: Token[] = [];
  const blocks = /```([\s\S]+?)```/g;
  let last = 0;
  for (const match of text.matchAll(blocks)) {
    tokens.push(...inlineCode(text.slice(last, match.index)));
    tokens.push({ type: 'mono', text: match[1] });
    last = match.index + match[0].length;
  }
  tokens.push(...inlineCode(text.slice(last)));
  return tokens;
}

function inlineCode(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    tokens.push(...marks(text.slice(last, match.index)));
    tokens.push({ type: 'code', text: match[1] });
    last = match.index + match[0].length;
  }
  tokens.push(...marks(text.slice(last)));
  return tokens;
}

function marks(text: string): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const mark = text[i] as keyof typeof MARKS;
    const end = MARKS[mark] && !wordChar(text[i - 1]) && !space(text[i + 1]) && text[i + 1] !== mark ? closing(text, i) : -1;
    if (end < 0) { plain += text[i++]; continue; }
    if (plain) { tokens.push(...links(plain)); plain = ''; }
    tokens.push({ type: MARKS[mark], children: marks(text.slice(i + 1, end)) });
    i = end + 1;
  }
  if (plain) tokens.push(...links(plain));
  return tokens;
}

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
