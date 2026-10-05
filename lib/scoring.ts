// Regras do edital de Macaé 2026 usadas na tela de resultados.
// Os pontos vêm prontos do banco (view race_scores); aqui ficam ordem, tempos e a chave.

export type Status = 'ok' | 'dnf' | 'dns';
export type DuelStage = 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';
/** Onde o barco parou no Match Race: a fase em que perdeu, ou o pódio. */
export type Stage = DuelStage | 'champion' | 'third_winner';

export type Score = {
  race_id: string; team_id: string; status: Status; note: string; laps: number; last_lap_at: string | null;
  stage: Stage | null; duel_time: number | null; position: number | null; points: number;
};
export type Duel = {
  race_id: string; stage: DuelStage; slot: number;
  team_a: string | null; team_b: string | null; time_a: number | null; time_b: number | null;
};
export type Penalty = { id: number; team_id: string; race_id: string | null; points: number; reason: string; created_at: string };

/** Itens de documentação pré-evento (3.1.1 a 3.1.7) e pontos por item entregue (3.4 e 4.4). */
export const DOC_ITEMS = 7;
export const ITEM_POINTS = 20;
export const DNF_POINTS = 20;

export const stageLabel: Record<Stage, string> = {
  champion: 'Campeão', final: 'Vice', third_winner: '3º lugar', third: '4º lugar',
  sf: 'Semifinal', qf: 'Quartas', r16: 'Oitavas', r32: '1ª fase',
};
export const duelStageLabel: Record<DuelStage, string> = {
  r32: '1ª fase', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', third: 'Disputa de 3º', final: 'Final',
};
const STAGE_ORDER: DuelStage[] = ['r32', 'r16', 'qf', 'sf', 'final'];

/** Geral: mais pontos; empate vai para a colocação na prova mais longa (10.1.7); depois o nome. */
export function sortStandings<T extends { points: number; tiebreak_position: number | null; name: string }>(teams: T[]) {
  return [...teams].sort((a, b) =>
    b.points - a.points || (a.tiebreak_position ?? 999) - (b.tiebreak_position ?? 999) || a.name.localeCompare(b.name, 'pt-BR'));
}

const statusOrder: Record<Status, number> = { ok: 0, dnf: 1, dns: 2 };
/** Prova: colocação; depois DNF (quem andou mais primeiro) e DNS. É também a ordem de pontos. */
export function sortRace(scores: Score[]) {
  return [...scores].sort((a, b) =>
    statusOrder[a.status] - statusOrder[b.status] || (a.position ?? 999) - (b.position ?? 999) || b.laps - a.laps);
}

/** Tempo de cada volta, em ms, a partir dos horários em que fecharam. */
export function lapSplits(completedAt: number[], start: number) {
  const times = [...completedAt].sort((a, b) => a - b);
  return times.map((time, i) => time - (i ? times[i - 1] : start));
}

/** Prazo para fechar a última volta depois do fim do tempo: 1/3 da prova ou 1h, o que for menor (10.1). */
export const closingWindowMinutes = (durationMinutes: number) => Math.min(durationMinutes / 3, 60);

const pad = (n: number) => String(n).padStart(2, '0');
/** 1:58:12 ou 9:07. */
export function formatDuration(ms: number) {
  const total = Math.round(Math.max(ms, 0) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
/** Tempo de X1 em segundos → 3:02,4. */
export function formatDuel(seconds: number) {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${pad(Math.floor(tenths % 600 / 10))},${tenths % 10}`;
}
/** Tempo de X1 digitado no painel (3:02,4 · 182.4 · 182,4) → segundos; null se não der para ler. */
export function parseDuel(text: string) {
  const match = text.trim().replace(',', '.').match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 60 + Number(match[2]);
  if (match[1] && Number(match[2]) >= 60) return null;
  return seconds > 0 && seconds < 100_000 ? Math.round(seconds * 100) / 100 : null;
}

/** Mesmo critério do banco: sem adversário passa direto; vence o menor tempo; sem tempo, perde. */
export function duelWinner(duel: Duel): 'a' | 'b' | null {
  if (!duel.team_a || !duel.team_b) return duel.team_a ? 'a' : duel.team_b ? 'b' : null;
  const { time_a: a, time_b: b } = duel;
  if (a !== null && (b === null || a < b)) return 'a';
  if (b !== null && (a === null || b < a)) return 'b';
  return null;
}

/**
 * Colunas da chave, da primeira fase até a final. Cada fase tem metade dos duelos da anterior;
 * um duelo que ainda não foi cadastrado vem como null ("a definir").
 * Sem nenhum duelo, `teamCount` desenha a chave vazia do tamanho que a prova vai ter.
 */
export function bracketColumns(duels: Duel[], teamCount = 0) {
  const present = STAGE_ORDER.filter(stage => duels.some(d => d.stage === stage));
  if (!present.length) {
    if (teamCount < 2) return [];
    const rounds = Math.min(Math.ceil(Math.log2(teamCount)), STAGE_ORDER.length);
    return STAGE_ORDER.slice(STAGE_ORDER.length - rounds).map((stage, i) =>
      ({ stage, duels: Array.from({ length: 2 ** (rounds - 1 - i) }, () => null) }));
  }
  const first = STAGE_ORDER.indexOf(present[0]);
  const firstCount = Math.max(...duels.filter(d => d.stage === present[0]).map(d => d.slot));
  const size = Math.max(firstCount, 2 ** (STAGE_ORDER.length - 1 - first));
  return STAGE_ORDER.slice(first).map((stage, i) => {
    const count = Math.max(1, size / 2 ** i);
    return { stage, duels: Array.from({ length: count }, (_, k) => duels.find(d => d.stage === stage && d.slot === k + 1) ?? null) };
  });
}

/** 0 a 1: quanto mais pontos na prova, mais forte a cor da célula (50 → 0, 150 → 1). */
export const pointsIntensity = (points: number) => Math.min(1, Math.max(0, (points - 50) / 100));
