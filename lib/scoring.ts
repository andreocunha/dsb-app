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
  sf: 'Semifinal', qf: 'Etapa 2', r16: 'Etapa 1', r32: '1ª fase',
};
export const duelStageLabel: Record<DuelStage, string> = {
  r32: '1ª fase', r16: 'Etapa 1', qf: 'Etapa 2', sf: 'Etapa 3 · Semifinal', third: 'Etapa 4 · 3º lugar', final: 'Final',
};

/** Geral: mais pontos; empate vai para a colocação na prova mais longa (10.1.7); depois o nome. */
export function sortStandings<T extends { points: number; tiebreak_position: number | null; name: string }>(teams: T[]) {
  return [...teams].sort((a, b) =>
    b.points - a.points || (a.tiebreak_position ?? 999) - (b.tiebreak_position ?? 999) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
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

type Feed = { code: string; take: 'winner' | 'loser' } | 'repescagem';
const won = (code: string): Feed => ({ code, take: 'winner' });
const lost = (code: string): Feed => ({ code, take: 'loser' });

/**
 * Chave do Match Race pela Instrução Técnica de 2026 (12 barcos). A Etapa 1 (A1 a A6) vem do
 * chaveamento da comissão; daí em diante cada duelo sabe de onde chegam os barcos. `col` e `row`
 * são o lugar no desenho: a Etapa 1 fica na ordem em que os vencedores se cruzam (A1 com A6…).
 * No banco, A = r16, B = qf, C = sf, e o slot é o número do duelo.
 */
const MATCH_PLAN: { code: string; stage: DuelStage; slot: number; col: number; row: number; a?: Feed; b?: Feed }[] = [
  { code: 'A1', stage: 'r16', slot: 1, col: 0, row: 0 },
  { code: 'A6', stage: 'r16', slot: 6, col: 0, row: 1 },
  { code: 'A2', stage: 'r16', slot: 2, col: 0, row: 2 },
  { code: 'A5', stage: 'r16', slot: 5, col: 0, row: 3 },
  { code: 'A3', stage: 'r16', slot: 3, col: 0, row: 4 },
  { code: 'A4', stage: 'r16', slot: 4, col: 0, row: 5 },
  { code: 'B1', stage: 'qf', slot: 1, col: 1, row: 0.5, a: won('A1'), b: won('A6') },
  { code: 'B2', stage: 'qf', slot: 2, col: 1, row: 2.5, a: won('A2'), b: won('A5') },
  { code: 'B3', stage: 'qf', slot: 3, col: 1, row: 4.5, a: won('A3'), b: won('A4') },
  { code: 'C1', stage: 'sf', slot: 1, col: 2, row: 0.5, a: won('B1'), b: 'repescagem' },
  { code: 'C2', stage: 'sf', slot: 2, col: 2, row: 3.5, a: won('B2'), b: won('B3') },
  { code: 'Final', stage: 'final', slot: 1, col: 3, row: 2, a: won('C1'), b: won('C2') },
  { code: '3º', stage: 'third', slot: 1, col: 3, row: 4.25, a: lost('C1'), b: lost('C2') },
];

/** Código do duelo na Instrução Técnica (A1, B2, Final…), pela fase e pelo número. */
export const duelCode = (stage: DuelStage, slot: number) => MATCH_PLAN.find(p => p.stage === stage && p.slot === slot)?.code ?? null;

export type PlanDuel = {
  code: string; col: number; row: number;
  /** O duelo como está valendo: os barcos lançados ou, na falta, os que a chave indica. */
  duel: Duel;
  saved: boolean;
  winner: 'a' | 'b' | null;
  /** O que aparece no lugar do barco enquanto ele não está definido. */
  waiting: { a: string; b: string };
  /** Duelos cujos vencedores chegam neste (as linhas do desenho). */
  feeders: string[];
  /** Barco lançado diferente do que a chave indica: um resultado anterior mudou depois. */
  stale: boolean;
};

/** Os 13 duelos da chave, na ordem em que acontecem, com os barcos que os resultados já definem. */
export function matchPlan(raceId: string, duels: Duel[]): PlanDuel[] {
  const plan: PlanDuel[] = [];
  const sides = ({ duel, winner }: PlanDuel) => !winner ? null
    : winner === 'a' ? { winner: duel.team_a, loser: duel.team_b, loserTime: duel.time_b } : { winner: duel.team_b, loser: duel.team_a, loserTime: duel.time_a };
  // Repescagem (B4): o perdedor de melhor tempo da Etapa 2, depois que os três duelos terminam.
  const repescagem = () => {
    const losers = plan.filter(p => p.duel.stage === 'qf').map(sides);
    if (losers.some(l => !l)) return null;
    return losers.filter(l => l!.loserTime !== null).sort((x, y) => x!.loserTime! - y!.loserTime!)[0]?.loser ?? null;
  };
  const teamFrom = (feed?: Feed) => {
    if (!feed) return null;
    if (feed === 'repescagem') return repescagem();
    const from = sides(plan.find(p => p.code === feed.code)!);
    return from && from[feed.take];
  };
  const label = (feed?: Feed) => !feed ? 'A definir' : feed === 'repescagem' ? 'Repescagem (B4)' : `${feed.take === 'winner' ? 'Vencedor' : 'Perdedor'} de ${feed.code}`;

  for (const { code, stage, slot, col, row, a, b } of MATCH_PLAN) {
    const saved = duels.find(d => d.stage === stage && d.slot === slot);
    const expected = [teamFrom(a), teamFrom(b)];
    const duel: Duel = {
      race_id: raceId, stage, slot, time_a: saved?.time_a ?? null, time_b: saved?.time_b ?? null,
      team_a: saved?.team_a ?? expected[0], team_b: saved?.team_b ?? expected[1],
    };
    // Só a Etapa 1 tem "passa direto"; nas outras, um lado vazio é barco que ainda vai chegar.
    const bye = !a && !b && !!saved && !!duel.team_a !== !!duel.team_b;
    plan.push({
      code, col, row, duel, saved: !!saved,
      winner: bye || (duel.team_a && duel.team_b) ? duelWinner(duel) : null,
      waiting: { a: label(a), b: bye && duel.team_a ? 'Passa direto' : label(b) },
      feeders: [a, b].flatMap(feed => feed && feed !== 'repescagem' && feed.take === 'winner' ? [feed.code] : []),
      stale: expected.some(team => team && team !== duel.team_a && team !== duel.team_b),
    });
  }
  return plan;
}

/** 0 a 1: quanto mais pontos na prova, mais forte a cor da célula (50 → 0, 150 → 1). */
export const pointsIntensity = (points: number) => Math.min(1, Math.max(0, (points - 50) / 100));
