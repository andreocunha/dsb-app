'use client';
import { useSyncExternalStore } from 'react';
import { races, type Race } from './mock-data';

const noop = () => () => {};
const upcomingIndex = () => {
  const index = races.findIndex(race => Date.parse(race.start) > Date.now());
  return index === -1 ? races.length : index;
};

/** Quantas provas já largaram. No build estático, nenhuma. */
export function useStartedCount() {
  return useSyncExternalStore(noop, upcomingIndex, () => 0);
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const raceDate = (race: Race) => { const text = dateFormat.format(new Date(race.start)).replace(/\./g, ''); return text[0].toUpperCase() + text.slice(1); };
export const raceTime = (race: Race) => timeFormat.format(new Date(race.start));
