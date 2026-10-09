'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { setRaces, type Race } from './data';
import type { ScheduleChange, ScheduleItem } from './schedule';

type EventItem = { id: string; title: string; starts_at: string; duration_minutes: number | null };
type ChangeRow = ScheduleChange & { race_id: string | null; event_item_id: string | null };

const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

function build(races: Race[], events: EventItem[], changes: ChangeRow[]): ScheduleItem[] {
  const changesOf = (pick: (row: ChangeRow) => boolean) => changes.filter(pick);
  return [
    ...races.map(race => ({
      key: `race:${race.id}`, kind: 'race' as const, id: race.id, title: race.name, label: `Prova ${race.number}`,
      startsAt: Date.parse(race.starts_at), startedAt: time(race.started_at), finishedAt: time(race.finished_at),
      durationMinutes: race.duration_minutes, closingMinutes: race.closing_minutes,
      changes: changesOf(row => row.race_id === race.id),
    })),
    ...events.map(event => ({
      key: `event:${event.id}`, kind: 'event' as const, id: event.id, title: event.title, label: '',
      startsAt: Date.parse(event.starts_at), startedAt: null, finishedAt: null,
      durationMinutes: event.duration_minutes, closingMinutes: null,
      changes: changesOf(row => row.event_item_id === event.id),
    })),
  ];
}

/**
 * Provas e demais itens da programação, atualizados ao vivo: atrasar, largar ou encerrar no painel
 * aparece na hora para quem está com o app aberto. `channel`: nome do canal de tempo real.
 */
export function useSchedule(channel = 'programacao') {
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const reloadRef = useRef(() => {});
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      const [races, events, changes] = await Promise.all([
        supabase.from('races').select('*').order('number'),
        supabase.from('event_items').select('*'),
        supabase.from('schedule_changes').select('race_id, event_item_id, previous_at, new_at, reason, changed_at').order('changed_at'),
      ]);
      if (!alive || races.error || events.error || changes.error) return;
      setRaces(races.data as Race[]);
      setItems(build(races.data as Race[], events.data, changes.data));
    };
    reloadRef.current = () => void reload();
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void reload(), 400); };
    void reload();
    const realtime = supabase.channel(channel);
    for (const table of ['races', 'event_items', 'schedule_changes']) realtime.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
    realtime.subscribe();
    // Ao voltar para o app (celular bloqueado, outra aba), o tempo real pode ter perdido algo.
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false; clearTimeout(timer); reloadRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(realtime);
    };
  }, [channel]);
  const reload = useCallback(() => reloadRef.current(), []);
  return { items, reload };
}

// Relógio de segundos, só para os componentes que mostram contagem regressiva.
const subscribeSecond = (tick: () => void) => { const id = setInterval(tick, 1000); return () => clearInterval(id); };
const second = () => Math.floor(Date.now() / 1000) * 1000;
/** Instante atual, avançando a cada segundo; 0 no build estático. */
export const useClock = () => useSyncExternalStore(subscribeSecond, second, () => 0);
