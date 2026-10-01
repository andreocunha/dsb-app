// Regras do fantasy usadas na tela. A validação de verdade fica no banco (save_lineup).
import type { RaceResult } from './data';

/** Uma escalação: até 3 barcos e, entre eles, o Turbo solar (vale o dobro). */
export type Lineup = { team_ids: string[]; double_team_id: string | null };

/** Pontos de um barco na prova, já dobrados se ele for o Turbo; undefined sem resultado. */
export function pickPoints(lineup: Lineup, results: RaceResult[], raceId: string, teamId: string) {
  const points = results.find(r => r.race_id === raceId && r.team_id === teamId)?.points;
  return points === undefined ? undefined : points * (teamId === lineup.double_team_id ? 2 : 1);
}

/** Pontos de uma escalação numa prova, com o Turbo contado em dobro. */
export const lineupPoints = (lineup: Lineup, results: RaceResult[], raceId: string) =>
  lineup.team_ids.reduce((total, id) => total + (pickPoints(lineup, results, raceId, id) ?? 0), 0);

/** Tempo até a largada em texto curto: "11 dias", "1d 4h", "3h 20min", "12 min", "menos de 1 min". */
export function closesIn(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'menos de 1 min';
  const d = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60;
  // Longe da largada, as horas só poluem; no último dia elas importam.
  if (d > 1) return `${d} dias`;
  if (d) return h ? `1d ${h}h` : '1 dia';
  if (h) return m ? `${h}h ${m}min` : `${h}h`;
  return `${m} min`;
}
