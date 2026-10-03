'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/data';

/** Vínculo de alguém com o DSB, como escolhido nas Configurações. */
export type Affiliation = {
  kind: 'team' | 'organization' | 'visitor';
  team: Pick<Team, 'id' | 'name' | 'initials' | 'color' | 'logo'> | null;
  status: 'member' | 'alumni' | null;
  /**
   * Tag de membro, como a do WhatsApp: o nome da equipe ("Solaris"), para membro e ex-membro,
   * ou "Organização". Aparece embaixo do nome, no balão e na lista de participantes.
   * Visitante fica sem tag, para não poluir o chat (a situação completa fica nos dados do contato).
   */
  tag: string | null;
};

/** Uma busca por sessão, compartilhada por todos os balões (o vínculo muda pouco). */
const EMPTY = new Map<string, Affiliation>();
let byUser = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= (async () => {
    const [{ data: people, error }, { data: teams }] = await Promise.all([
      supabase.from('profiles').select('id, affiliation, team_id, team_status').not('affiliation', 'is', null).limit(2000),
      supabase.from('teams').select('id, name, initials, color, logo'),
    ]);
    if (error) throw error;
    const teamsById = new Map((teams ?? []).map(t => [t.id, t]));
    const next = new Map<string, Affiliation>();
    for (const p of people ?? []) {
      const team = p.team_id ? teamsById.get(p.team_id) ?? null : null;
      if (p.affiliation === 'organization') next.set(p.id, { kind: 'organization', team: null, status: null, tag: 'Organização' });
      else if (p.affiliation === 'visitor') next.set(p.id, { kind: 'visitor', team: null, status: null, tag: null });
      else if (team) next.set(p.id, { kind: 'team', team, status: p.team_status === 'alumni' ? 'alumni' : 'member', tag: team.name });
    }
    byUser = next;
    listeners.forEach(listener => listener());
  })().catch(() => { loading = null; });
  return loading;
}

/** Depois de mudar o próprio vínculo nas Configurações: a próxima leitura busca de novo. */
export function forgetAffiliations() {
  loading = null;
  if (listeners.size) void load();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Vínculo completo (equipe, situação), para os dados do contato. */
export function useAffiliationOf(userId: string) {
  const map = useSyncExternalStore(subscribe, () => byUser, () => EMPTY);
  useEffect(() => { void load(); }, []);
  return map.get(userId) ?? null;
}

/** Só a tag que vai ao lado do nome. */
export const useAffiliation = (userId: string) => useAffiliationOf(userId)?.tag ?? null;

/** Linha de baixo na lista de participantes: a tag, ou o texto de sempre para quem não tem. */
export function MemberTag({ id, fallback }: { id: string; fallback: string }) {
  return <small>{useAffiliation(id) ?? fallback}</small>;
}

/** "Projeto Solares · Ex-membro", "Organização do evento", "Visitante": a situação por extenso. */
export function affiliationLine(a: Affiliation | null) {
  if (!a) return null;
  if (a.kind === 'organization') return 'Organização do evento';
  if (a.kind === 'visitor') return 'Visitante';
  return `${a.team!.name} · ${a.status === 'alumni' ? 'Ex-membro' : 'Membro'}`;
}
