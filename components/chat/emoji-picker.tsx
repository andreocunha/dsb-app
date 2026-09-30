'use client';
import { useEffect, useRef, useState } from 'react';
import { Car, Cat, Coffee, Flag, Lightbulb, Search, Shapes, Smile, Volleyball } from 'lucide-react';

/**
 * Painel de emojis do WhatsApp Web: abas de categoria com o sublinhado verde, busca,
 * seções com título e grade. Os dados (nomes e palavras-chave em português) ficam em
 * public/emoji/pt.json e só são baixados na primeira vez que o painel abre.
 */
type Emoji = { emoji: string; annotation: string; tags?: string[]; shortcodes?: string[]; group: number; order: number; version: number };

// Emojis mais novos que isso ainda aparecem como quadradinho em muitos celulares.
const MAX_VERSION = 15;
const RECENT_KEY = 'dsb-emojis-recentes';
const RECENT_MAX = 24;
const CATEGORIES = [
  { id: 'people', label: 'Smileys e pessoas', icon: Smile, groups: [0, 1] },
  { id: 'nature', label: 'Animais e natureza', icon: Cat, groups: [3] },
  { id: 'food', label: 'Comidas e bebidas', icon: Coffee, groups: [4] },
  { id: 'activity', label: 'Atividades', icon: Volleyball, groups: [6] },
  { id: 'travel', label: 'Viagens e lugares', icon: Car, groups: [5] },
  { id: 'objects', label: 'Objetos', icon: Lightbulb, groups: [7] },
  { id: 'symbols', label: 'Símbolos', icon: Shapes, groups: [8] },
  { id: 'flags', label: 'Bandeiras', icon: Flag, groups: [9] },
];

let data: Promise<Emoji[]> | null = null;
function loadEmojis() {
  data ??= fetch('/emoji/pt.json')
    .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<Emoji[]>; })
    .then(list => list.filter(e => e.version <= MAX_VERSION && e.group !== 2).sort((a, b) => a.order - b.order))
    .catch(error => { data = null; throw error; });
  return data;
}

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function saveRecent(emoji: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...readRecent().filter(e => e !== emoji)].slice(0, RECENT_MAX))); } catch { /* sem localStorage: só não guarda */ }
}

export function EmojiPicker({ onPick, className = '', autoFocus = false }: { onPick: (emoji: string) => void; className?: string; autoFocus?: boolean }) {
  const [emojis, setEmojis] = useState<Emoji[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(CATEGORIES[0].id);
  // Lidos uma vez ao abrir: a lista não pula de lugar enquanto a pessoa escolhe.
  const [recent] = useState(readRecent);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadEmojis().then(list => { if (alive) setEmojis(list); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  function pick(emoji: string) {
    saveRecent(emoji);
    onPick(emoji);
  }

  function goTo(id: string) {
    setQuery('');
    setActive(id);
    requestAnimationFrame(() => {
      const section = scroller.current?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (scroller.current && section) scroller.current.scrollTop = id === CATEGORIES[0].id ? 0 : section.offsetTop;
    });
  }

  // A aba acompanha a rolagem, como no WhatsApp.
  function onScroll() {
    const el = scroller.current;
    if (!el || query) return;
    let current = CATEGORIES[0].id;
    for (const section of el.querySelectorAll<HTMLElement>('[data-section]')) if (section.offsetTop <= el.scrollTop + 24) current = section.dataset.section!;
    if (current === 'recent') current = CATEGORIES[0].id;
    if (current !== active) setActive(current);
  }

  // Setas andam pela grade; Enter na busca escolhe o primeiro resultado.
  function onGridKey(e: React.KeyboardEvent) {
    const buttons = [...scroller.current!.querySelectorAll<HTMLButtonElement>('.emoji-grid button')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const columns = getComputedStyle(buttons[i].parentElement!).gridTemplateColumns.split(' ').length;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[e.key];
    if (!step) return;
    e.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, i + step))].focus();
  }

  const term = normalize(query.trim());
  const results = term && emojis ? emojis.filter(e => normalize(e.annotation).includes(term)
    || e.tags?.some(tag => normalize(tag).includes(term)) || e.shortcodes?.some(code => code.includes(term.replace(/\s+/g, '_')))) : null;
  const grid = (list: string[], names?: Map<string, string>) => <div className="emoji-grid">
    {list.map(emoji => <button key={emoji} type="button" tabIndex={-1} title={names?.get(emoji)} aria-label={names?.get(emoji) ?? emoji} onClick={() => pick(emoji)}>{emoji}</button>)}
  </div>;
  const names = new Map(emojis?.map(e => [e.emoji, e.annotation]));

  return <div className={`emoji-panel ${className}`} role="dialog" aria-label="Emojis">
    <div className="emoji-tabs" role="tablist">
      {CATEGORIES.map(category => <button key={category.id} type="button" role="tab" aria-selected={!query && active === category.id}
        aria-label={category.label} title={category.label} onClick={() => goTo(category.id)}><category.icon size={22} /></button>)}
    </div>
    <label className="emoji-search">
      <Search size={18} />
      <input value={query} onChange={e => { setQuery(e.target.value); if (scroller.current) scroller.current.scrollTop = 0; }} placeholder="Pesquisar emoji" aria-label="Pesquisar emoji"
        autoFocus={autoFocus}
        onKeyDown={e => {
          if (e.key === 'Enter' && results?.[0]) { e.preventDefault(); pick(results[0].emoji); }
          if (e.key === 'ArrowDown') { e.preventDefault(); scroller.current?.querySelector<HTMLButtonElement>('.emoji-grid button')?.focus(); }
        }} />
    </label>
    <div className="emoji-scroll" ref={scroller} onScroll={onScroll} onKeyDown={onGridKey}>
      {failed ? <p className="emoji-empty">Não foi possível carregar os emojis. Verifique sua conexão.</p>
        : !emojis ? <p className="emoji-empty">Carregando…</p>
        : results ? (results.length
          ? <section><h3>Resultados</h3>{grid(results.map(e => e.emoji), names)}</section>
          : <p className="emoji-empty">Nenhum emoji encontrado</p>)
        : <>
          {recent.length > 0 && <section data-section="recent"><h3>Recentes</h3>{grid(recent, names)}</section>}
          {CATEGORIES.map(category => <section key={category.id} data-section={category.id}>
            <h3>{category.label}</h3>
            {grid(emojis.filter(e => category.groups.includes(e.group)).map(e => e.emoji), names)}
          </section>)}
        </>}
    </div>
  </div>;
}
