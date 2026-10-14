'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTeams, type Team } from '@/lib/data';
import { duelCode, formatDuel, type DuelStage } from '@/lib/scoring';
import { TeamBadge } from './ui';

// Sobre o mapa: o relógio dos duelos do Match Race em andamento e um balão rápido a cada volta
// ou chegada lançada pela organização. Uma assinatura de tempo real só, ligada enquanto a home está na tela.

type FeedDuel = {
  race_id: string; stage: DuelStage; slot: number; team_a: string | null; team_b: string | null;
  time_a: number | null; time_b: number | null; started_at: string | null;
};
type Pop = { id: number; team: string; text: string; lap: boolean };

const keyOf = (d: Pick<FeedDuel, 'race_id' | 'stage' | 'slot'>) => `${d.race_id}|${d.stage}|${d.slot}`;
const seconds = (value: unknown) => value === null || value === undefined ? null : Number(value);
const normalize = (row: FeedDuel): FeedDuel => ({ ...row, time_a: seconds(row.time_a), time_b: seconds(row.time_b) });
const running = (d: FeedDuel) => !!d.started_at && !!d.team_a && !!d.team_b && (d.time_a === null || d.time_b === null);
// Largada que ninguém encerrou (ou tempo apagado depois) não fica contando para sempre.
const STALE = 30 * 60_000;
const MAX_POPS = 4;
let seq = 0;

export function RaceFeed({ active }: { active: boolean }) {
  const { data: teams } = useTeams();
  const [duels, setDuels] = useState<FeedDuel[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const known = new Map<string, FeedDuel>();
    const publish = () => { if (alive) setDuels([...known.values()]); };
    const pop = (team: string | null, text: string, lap: boolean) => {
      if (alive && team) setPops(current => [...current.slice(1 - MAX_POPS), { id: ++seq, team, text, lap }]);
    };
    // Base para comparar: sem ela, não dá para saber qual barco acabou de chegar.
    async function load() {
      const { data } = await supabase.from('match_duels').select('race_id, stage, slot, team_a, team_b, time_a, time_b, started_at');
      known.clear();
      for (const row of (data ?? []) as FeedDuel[]) known.set(keyOf(row), normalize(row));
      publish();
    }
    const channel = supabase.channel(`mapa-${++seq}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'race_laps' }, ({ new: lap }) => pop((lap as { team_id: string }).team_id, '+1 volta', true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_duels' }, ({ eventType, new: fresh, old }) => {
        if (eventType === 'DELETE') { known.delete(keyOf(old as FeedDuel)); return publish(); }
        const row = normalize(fresh as FeedDuel);
        const before = known.get(keyOf(row)) ?? (eventType === 'INSERT' ? { ...row, time_a: null, time_b: null } : null);
        if (before) for (const side of ['a', 'b'] as const) {
          const time = row[`time_${side}`];
          if (before[`time_${side}`] === null && time !== null) pop(row[`team_${side}`], formatDuel(time), false);
        }
        known.set(keyOf(row), row);
        publish();
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') void load(); });
    return () => { alive = false; void supabase.removeChannel(channel); setPops([]); setDuels([]); };
  }, [active]);

  // Décimos só com duelo valendo; parado, nada roda.
  const ticking = duels.some(running);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [ticking]);

  const byId = new Map((teams ?? []).map(t => [t.id, t]));
  const clocks = now ? duels.filter(d => running(d) && now - Date.parse(d.started_at!) < STALE) : [];
  if (!clocks.length && !pops.length) return null;
  return <div className="feed" aria-live="polite">
    {pops.map(p => <span key={p.id} className={`feed-pop ${p.lap ? 'lap' : ''}`} onAnimationEnd={() => setPops(current => current.filter(x => x.id !== p.id))}>
      <Badge team={byId.get(p.team)} />
      <b>{p.text}</b>
      <span className="feed-name">{byId.get(p.team)?.name}</span>
    </span>)}
    {clocks.map(d => <div key={keyOf(d)} className="feed-clock">
      <span className="feed-code">{duelCode(d.stage, d.slot) ?? 'X1'}</span>
      {(['a', 'b'] as const).map((side, i) => <span key={side} className={`feed-side ${d[`time_${side}`] !== null ? 'done' : ''}`}>
        {i === 1 && <span className="feed-vs">×</span>}
        <Badge team={byId.get(d[`team_${side}`]!)} />
        <span className="feed-name">{byId.get(d[`team_${side}`]!)?.name}</span>
      </span>)}
      <strong>{formatDuel(Math.max(now - Date.parse(d.started_at!), 0) / 1000)}</strong>
    </div>)}
  </div>;
}

const Badge = ({ team }: { team?: Team }) => team ? <TeamBadge team={team} small /> : null;
