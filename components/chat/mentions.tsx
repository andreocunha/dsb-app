'use client';
import { createContext, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { fold, MENTION_ALL, type Mentionable } from '@/lib/chat-format';
import { shortName } from '@/lib/names';
import { supabase } from '@/lib/supabase';
import { Avatar } from '../ui';
import type { Person } from './types';

const MAX_SUGGESTIONS = 50;
const NOBODY: Person[] = [];
/** O @all na lista e no balão: não é uma pessoa, marca todo mundo da conversa. */
export const ALL: Person = { id: MENTION_ALL, name: MENTION_ALL, avatar_url: null };
export const ALL_MENTIONABLE: Mentionable = { id: MENTION_ALL, label: MENTION_ALL };

/**
 * Quem pode ser marcado no grupo, para o balão pintar o @Nome. Fora do grupo fica vazio.
 * onOpen: tocar na menção de outra pessoa abre a conversa com ela, como no WhatsApp.
 */
export type MentionContext = { people: Mentionable[]; me: string | null; onOpen?: (id: string) => void };
export const MentionPeople = createContext<MentionContext>({ people: [], me: null });

// Uma busca por sessão: a lista é a mesma em todas as conversas.
let cache: Promise<Person[]> | null = null;
function loadPeople() {
  cache ??= Promise.resolve(supabase.from('profiles').select('id, name, avatar_url').is('banned_at', null).order('name').limit(1000))
    .then(({ data, error }) => { if (error) cache = null; return data ?? []; });
  return cache;
}

/** Todo mundo que entrou no app, inclusive você (para ver quando te marcaram). */
export function usePeople(enabled: boolean) {
  const [people, setPeople] = useState<Person[]>(NOBODY);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadPeople().then(list => { if (alive) setPeople(list); });
    return () => { alive = false; };
  }, [enabled]);
  return enabled ? people : NOBODY;
}

/** O balão reconhece o nome inteiro e o curto, que é o que entra no texto ao escolher alguém. */
export function useMentionables(people: Person[]) {
  return useMemo(() => people.flatMap(p => {
    const short = shortName(p.name);
    return short === p.name.trim() ? [{ id: p.id, label: short }] : [{ id: p.id, label: short }, { id: p.id, label: p.name.trim() }];
  }), [people]);
}

/**
 * Quem combina com o que veio depois do @: começo do nome ou de qualquer sobrenome, sem ligar para acento.
 * all: quem pode marcar todo mundo vê o @all primeiro, enquanto o que foi digitado combinar com "all".
 */
export function suggest(people: Person[], query: string, userId: string | null, all = false) {
  const q = fold(query);
  const everyone = all && MENTION_ALL.startsWith(q) ? [ALL] : [];
  return [...everyone, ...people.filter(p => p.id !== userId && (` ${fold(p.name)}`.includes(` ${q}`) || fold(shortName(p.name)).startsWith(q)))].slice(0, MAX_SUGGESTIONS);
}

/** Lista que abre em cima da barra de digitar, como a do WhatsApp. O toque não tira o foco do campo. */
export function MentionList({ id, people, active, onPick, onHover }: {
  id: string; people: Person[]; active: number; onPick: (person: Person) => void; onHover: (index: number) => void;
}) {
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, active]);

  return <div id={id} className="mention-list" role="listbox" aria-label="Marcar alguém">
    {people.map((person, i) => <div key={person.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className="mention-option"
      onPointerDown={e => e.preventDefault()} onPointerEnter={() => onHover(i)} onClick={() => onPick(person)}>
      {person.id === ALL.id ? <>
        <span className="avatar small mention-all-icon"><Users size={16} /></span>
        <span><strong>@all</strong><small>Marcar todo mundo do grupo</small></span>
      </> : <>
        <Avatar id={person.id} name={person.name} url={person.avatar_url} small />
        <span><strong>{shortName(person.name)}</strong>{person.name.trim() !== shortName(person.name) && <small>{person.name}</small>}</span>
      </>}
    </div>)}
  </div>;
}
