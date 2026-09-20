'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Tier = 'A' | 'B' | 'C';
export type Team = { id: string; name: string; university: string; initials: string; color: string; tier: Tier; logo: string | null; points: number };
export type Race = { id: string; number: number; name: string; starts_at: string };

export type RaceResult = { race_id: string; team_id: string; points: number };

/** Quantos barcos cada pessoa escala por prova, e quantos pontos vale o barco do 2x. */
export const PICKS_PER_RACE = 3;

// Cache por sessão: barcos e provas mudam pouco e são lidos em várias telas.
function cached<T>(load: () => Promise<T>) {
  let promise: Promise<T> | null = null;
  let value: T | null = null;
  return {
    peek: () => value,
    load: (fresh = false) => {
      if (fresh || !promise) promise = load().then(v => (value = v)).catch(e => { promise = null; throw e; });
      return promise;
    },
  };
}
function useCached<T>(store: ReturnType<typeof cached<T>>) {
  const [value, setValue] = useState<T | null>(store.peek);
  const [error, setError] = useState(false);
  useEffect(() => { store.load().then(setValue, () => setError(true)); }, [store]);
  return { data: value, error };
}

const teamsStore = cached(async () => {
  const { data, error } = await supabase.from('team_standings').select('*').order('points', { ascending: false }).order('name');
  if (error) throw error;
  return data as Team[];
});
const racesStore = cached(async () => {
  const { data, error } = await supabase.from('races').select('*').order('number');
  if (error) throw error;
  return data;
});

export const useTeams = () => useCached(teamsStore);

/** Pontos dos barcos em cada prova; recarrega a cada visita, porque a organização publica durante o evento. */
export function useRaceResults() {
  const [results, setResults] = useState<RaceResult[] | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.from('race_results').select('race_id, team_id, points').then(({ data }) => { if (alive) setResults(data ?? []); });
    return () => { alive = false; };
  }, []);
  return results;
}
export const useRaces = () => useCached(racesStore);
