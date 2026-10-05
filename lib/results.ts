'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Team } from './data';
import type { Duel, Penalty, Score } from './scoring';

export type ResultsData = { teams: Team[]; scores: Score[]; duels: Duel[]; penalties: Penalty[] };

// Durante a prova as voltas chegam uma a uma: junta as mudanças e recarrega uma vez só.
function onResultsChange(name: string, tables: { table: string; filter?: string }[], reload: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const channel = supabase.channel(name);
  for (const { table, filter } of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 800);
    });
  }
  channel.subscribe();
  return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
}

async function loadResults(): Promise<ResultsData> {
  const [teams, scores, duels, penalties] = await Promise.all([
    supabase.from('team_standings').select('*'),
    supabase.from('race_scores').select('*'),
    supabase.from('match_duels').select('*'),
    supabase.from('penalties').select('*').order('created_at'),
  ]);
  const error = teams.error ?? scores.error ?? duels.error ?? penalties.error;
  if (error) throw error;
  return {
    teams: teams.data as Team[], scores: scores.data as Score[],
    duels: duels.data as Duel[], penalties: penalties.data as Penalty[],
  };
}

/**
 * Classificação, pontos por prova, chave e penalidades, atualizados ao vivo enquanto `active`.
 * `channel`: nome do canal de tempo real (o painel da organização usa o seu, separado do da home).
 */
export function useResults(active = true, channel = 'resultados') {
  const [data, setData] = useState<ResultsData | null>(null);
  const [error, setError] = useState(false);
  const reloadRef = useRef(() => {});
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const reload = () => loadResults().then(next => { if (alive) { setData(next); setError(false); } }, () => { if (alive) setError(true); });
    reloadRef.current = () => void reload();
    void reload();
    const stop = onResultsChange(channel, [{ table: 'race_laps' }, { table: 'race_status' }, { table: 'match_duels' }, { table: 'penalties' }], reload);
    return () => { alive = false; reloadRef.current = () => {}; stop(); };
  }, [active, channel]);
  // Documentação e artigo (tabela teams) não chegam pelo tempo real: o painel recarrega depois de salvar.
  const reload = useCallback(() => reloadRef.current(), []);
  return { data, error, reload };
}

/** Horários das voltas de uma prova, por barco (ms). */
export function useRaceLaps(raceId: string) {
  const [laps, setLaps] = useState<{ raceId: string; byTeam: Map<string, number[]> } | null>(null);
  useEffect(() => {
    let alive = true;
    const reload = async () => {
      const { data, error } = await supabase.from('race_laps').select('team_id, completed_at').eq('race_id', raceId).order('completed_at');
      if (!alive || error) return;
      const byTeam = new Map<string, number[]>();
      for (const row of data) byTeam.set(row.team_id, [...(byTeam.get(row.team_id) ?? []), Date.parse(row.completed_at)]);
      setLaps({ raceId, byTeam });
    };
    void reload();
    const stop = onResultsChange(`voltas-${raceId}`, [{ table: 'race_laps', filter: `race_id=eq.${raceId}` }], () => void reload());
    return () => { alive = false; stop(); };
  }, [raceId]);
  // Ao trocar de prova, não mostra as voltas da anterior enquanto carrega.
  return laps?.raceId === raceId ? laps.byTeam : null;
}
