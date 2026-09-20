'use client';
import { useSyncExternalStore } from 'react';
import type { Race } from './data';

// Relógio compartilhado que avança a cada 30s: suficiente para travar escalações na largada.
const subscribe = (tick: () => void) => { const id = setInterval(tick, 30_000); return () => clearInterval(id); };
const snapshot = () => Math.floor(Date.now() / 30_000) * 30_000;
/** Instante atual; 0 no build estático (nenhuma prova largou). */
export const useNow = () => useSyncExternalStore(subscribe, snapshot, () => 0);
export const hasStarted = (race: Race, now: number) => now > 0 && Date.parse(race.starts_at) <= now;
/** Próxima prova que ainda não largou, ou a última. */
export const nextRace = (races: Race[], now: number) => races.find(race => !hasStarted(race, now)) ?? races[races.length - 1];

const dateFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const raceDate = (race: Race) => { const text = dateFormat.format(new Date(race.starts_at)).replace(/\./g, ''); return text[0].toUpperCase() + text.slice(1); };
export const raceTime = (race: Race) => timeFormat.format(new Date(race.starts_at));
