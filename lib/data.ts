'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Linha de team_standings: `points` já soma provas, documentação, artigo e penalidades. */
export type Team = {
  id: string; name: string; university: string; initials: string; color: string; logo: string | null; points: number;
  race_points: number; docs_delivered: number; article_delivered: boolean; penalty_points: number; tiebreak_position: number | null;
};
export type Race = {
  id: string; number: number; name: string; starts_at: string; kind: 'laps' | 'bracket';
  duration_minutes: number | null; closing_minutes: number | null; started_at: string | null; finished_at: string | null;
};

export type RaceResult = { race_id: string; team_id: string; points: number };

/** Quantos barcos cada pessoa escala por prova (o banco confere o mesmo limite em save_lineup). */
export const PICKS_PER_RACE = 3;

// Cache por sessão: barcos e provas mudam pouco e são lidos em várias telas.
// `set` troca o valor de todas as telas de uma vez (a programação empurra os horários novos por aqui).
function cached<T>(load: () => Promise<T>) {
  let promise: Promise<T> | null = null;
  let value: T | null = null;
  const listeners = new Set<(value: T) => void>();
  const set = (next: T) => { value = next; promise = Promise.resolve(next); listeners.forEach(listener => listener(next)); return next; };
  return {
    peek: () => value,
    set,
    subscribe: (listener: (value: T) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: (fresh = false) => {
      if (fresh || !promise) promise = load().then(set).catch(e => { promise = null; throw e; });
      return promise;
    },
  };
}
function useCached<T>(store: ReturnType<typeof cached<T>>) {
  const [value, setValue] = useState<T | null>(store.peek);
  const [error, setError] = useState(false);
  useEffect(() => {
    store.load().then(setValue, () => setError(true));
    return store.subscribe(setValue);
  }, [store]);
  return { data: value, error };
}

const teamsStore = cached(async () => {
  const { data, error } = await supabase.from('team_standings').select('*').order('name');
  if (error) throw error;
  return data as Team[];
});
const racesStore = cached(async () => {
  const { data, error } = await supabase.from('races').select('*').order('number');
  if (error) throw error;
  return data as Race[];
});

export const useTeams = () => useCached(teamsStore);

/** Pontos dos barcos em cada prova; recarrega a cada visita, porque a organização publica durante o evento. */
export function useRaceResults() {
  const [results, setResults] = useState<RaceResult[] | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.from('race_results').select('race_id, team_id, points').then(({ data }) => { if (alive) setResults((data ?? []) as RaceResult[]); });
    return () => { alive = false; };
  }, []);
  return results;
}
export const useRaces = () => useCached(racesStore);
/** Horários novos vindos do tempo real: valem para todas as telas que leem as provas. */
export const setRaces = (races: Race[]) => racesStore.set(races);
