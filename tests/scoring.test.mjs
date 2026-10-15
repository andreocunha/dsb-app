import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLALOM_WINDOW, closingWindowMinutes, duelWinner, formatDuel, formatDuration, formatGap, isRunning, lapSplits, matchPlan, nextAttempt, parseDuel, pointsIntensity, slalomStart, sortRace, sortStandings, sprintFinalists } from '../lib/scoring.ts';

const duel = (stage, slot, team_a, team_b, time_a = null, time_b = null) => ({ race_id: 'match-race', stage, slot, team_a, team_b, time_a, time_b });
const score = (team_id, status, position, laps = 0) => ({ race_id: 'r', team_id, status, position, laps, note: '', last_lap_at: null, stage: null, duel_time: null, points: 0 });

test('geral desempata pela prova mais longa e depois pelo nome', () => {
  const order = sortStandings([
    { name: 'Zênite', points: 900, tiebreak_position: 1 },
    { name: 'Arariboia', points: 900, tiebreak_position: 3 },
    { name: 'Solaris', points: 1000, tiebreak_position: null },
    { name: 'Babitonga', points: 900, tiebreak_position: null },
    { name: 'Albardão', points: 900, tiebreak_position: null },
  ]).map(t => t.name);
  assert.deepEqual(order, ['Solaris', 'Zênite', 'Arariboia', 'Albardão', 'Babitonga']);
});

test('prova lista colocados, depois DNF (quem andou mais primeiro) e DNS', () => {
  const order = sortRace([score('dns', 'dns', null), score('dnf1', 'dnf', null, 1), score('b', 'ok', 2), score('dnf3', 'dnf', null, 3), score('a', 'ok', 1)]).map(s => s.team_id);
  assert.deepEqual(order, ['a', 'b', 'dnf3', 'dnf1', 'dns']);
});

test('tempo de volta sai da diferença entre horários, a primeira desde a largada', () => {
  assert.deepEqual(lapSplits([1_300_000, 700_000, 100_000], 0), [100_000, 600_000, 600_000]);
});

test('prazo da última volta é 1/3 do tempo ou 1h, o que for menor', () => {
  assert.equal(closingWindowMinutes(30), 10);
  assert.equal(closingWindowMinutes(240), 60);
});

test('formata tempos de prova e de X1', () => {
  assert.equal(formatDuration(547_000), '9:07');
  assert.equal(formatDuration(7_092_000), '1:58:12');
  assert.equal(formatDuel(182.44), '3:02,4');
  assert.equal(formatDuel(59.96), '1:00,0');
});

test('vencedor do duelo: menor tempo; sem tempo perde; sem adversário passa', () => {
  assert.equal(duelWinner(duel('qf', 1, 'a', 'b', 180, 181)), 'a');
  assert.equal(duelWinner(duel('qf', 1, 'a', 'b', 185, 181)), 'b');
  assert.equal(duelWinner(duel('qf', 1, 'a', 'b', null, 181)), 'b');
  assert.equal(duelWinner(duel('qf', 1, 'a', null)), 'a');
  assert.equal(duelWinner(duel('qf', 1, 'a', 'b')), null);
  assert.equal(duelWinner(duel('qf', 1, 'a', 'b', 180, 180)), null);
});

// Chaveamento da comissão para 2026: An é o duelo n da Etapa 1 (r16).
const etapa1 = times => [['zenite', 'amorim'], ['solares', 'leviata'], ['sete', 'reis'], ['hurakan', 'hefesto'], ['solaris', 'solmar'], ['arariboia', 'gunes']]
  .map(([a, b], i) => duel('r16', i + 1, a, b, ...(times?.[i] ?? [])));
const teamsOf = (plan, code) => { const { duel } = plan.find(p => p.code === code); return [duel.team_a, duel.team_b]; };

test('chave da Instrução Técnica: 13 duelos, com a Etapa 1 lançada e o resto a definir', () => {
  const plan = matchPlan('match-race', etapa1());
  assert.deepEqual(plan.map(p => p.code), ['A1', 'A6', 'A2', 'A5', 'A3', 'A4', 'B1', 'B2', 'B3', 'C1', 'C2', 'Final', '3º']);
  assert.deepEqual(teamsOf(plan, 'A4'), ['hurakan', 'hefesto']);
  assert.deepEqual(teamsOf(plan, 'B1'), [null, null]);
  assert.deepEqual(plan.find(p => p.code === 'B1').waiting, { a: 'Vencedor de A1', b: 'Vencedor de A6' });
  assert.deepEqual(plan.find(p => p.code === 'C1').waiting, { a: 'Vencedor de B1', b: 'Repescagem (B4)' });
  assert.deepEqual(plan.find(p => p.code === '3º').waiting, { a: 'Perdedor de C1', b: 'Perdedor de C2' });
  assert.ok(plan.every(p => p.winner === null && !p.stale));
  assert.equal(matchPlan('match-race', []).length, 13);
});

test('vencedores se cruzam A1×A6, A2×A5, A3×A4 e o melhor perdedor da Etapa 2 volta em C1', () => {
  // Na Etapa 1 vence sempre o barco A, menos em A6 (Güneş).
  const first = etapa1([[100, 110], [101, 111], [102, 112], [103, 113], [104, 114], [120, 105]]);
  let plan = matchPlan('match-race', first);
  assert.deepEqual(teamsOf(plan, 'B1'), ['zenite', 'gunes']);
  assert.deepEqual(teamsOf(plan, 'B2'), ['solares', 'solaris']);
  assert.deepEqual(teamsOf(plan, 'B3'), ['sete', 'hurakan']);
  assert.equal(plan.find(p => p.code === 'B1').saved, false);

  // Duas da Etapa 2 terminadas: a repescagem ainda não está definida.
  const second = [...first, duel('qf', 1, 'zenite', 'gunes', 100, 109), duel('qf', 2, 'solares', 'solaris', 108, 101)];
  plan = matchPlan('match-race', second);
  assert.deepEqual(teamsOf(plan, 'C1'), ['zenite', null]);
  assert.deepEqual(teamsOf(plan, 'C2'), ['solaris', null]);
  assert.equal(plan.find(p => p.code === 'C1').winner, null);

  // Perdedores da Etapa 2: Güneş 109, Solares 108, Hurakan 107 → Hurakan volta na repescagem.
  const third = [...second, duel('qf', 3, 'sete', 'hurakan', 102, 107)];
  plan = matchPlan('match-race', third);
  assert.deepEqual(teamsOf(plan, 'C1'), ['zenite', 'hurakan']);
  assert.deepEqual(teamsOf(plan, 'C2'), ['solaris', 'sete']);

  const semis = [...third, duel('sf', 1, 'zenite', 'hurakan', 99, 98), duel('sf', 2, 'solaris', 'sete', 97, 99)];
  plan = matchPlan('match-race', semis);
  assert.deepEqual(teamsOf(plan, 'Final'), ['hurakan', 'solaris']);
  assert.deepEqual(teamsOf(plan, '3º'), ['zenite', 'sete']);
  assert.equal(plan.find(p => p.code === 'Final').winner, null);
});

test('barco lançado vale sobre o da chave, e o duelo avisa quando ficou diferente', () => {
  const first = etapa1([[100, 110], [101, 111], [102, 112], [103, 113], [104, 114], [120, 105]]);
  // B1 foi lançado com Zênite; depois o tempo de A1 foi corrigido e quem passou foi o Fernando Amorim.
  first[0] = duel('r16', 1, 'zenite', 'amorim', 100, 90);
  const plan = matchPlan('match-race', [...first, duel('qf', 1, 'zenite', 'gunes', 100, 109)]);
  const b1 = plan.find(p => p.code === 'B1');
  assert.deepEqual([b1.duel.team_a, b1.saved, b1.stale], ['zenite', true, true]);
  assert.equal(plan.find(p => p.code === 'B2').stale, false);
});

test('só a Etapa 1 tem "passa direto"', () => {
  const plan = matchPlan('match-race', [duel('r16', 1, 'zenite', null), duel('r16', 6, 'arariboia', 'gunes', 100, 101)]);
  assert.equal(plan.find(p => p.code === 'A1').winner, 'a');
  assert.equal(plan.find(p => p.code === 'A1').waiting.b, 'Passa direto');
  assert.deepEqual(teamsOf(plan, 'B1'), ['zenite', 'arariboia']);
  // B2 só com um lado definido não é vitória de ninguém.
  const half = matchPlan('match-race', [duel('r16', 2, 'solares', 'leviata', 100, 101)]);
  assert.deepEqual([teamsOf(half, 'B2'), half.find(p => p.code === 'B2').winner], [['solares', null], null]);
});

test('intensidade da cor vai de 50 a 150 pontos', () => {
  assert.equal(pointsIntensity(150), 1);
  assert.equal(pointsIntensity(100), .5);
  assert.equal(pointsIntensity(20), 0);
});

test('lê o tempo do X1 digitado no painel', () => {
  assert.equal(parseDuel('3:02,4'), 182.4);
  assert.equal(parseDuel('182.4'), 182.4);
  assert.equal(parseDuel(' 182,45 '), 182.45);
  assert.equal(parseDuel('0:59'), 59);
  for (const text of ['', 'abc', '3:75', '0', '-12', '1:2:3']) assert.equal(parseDuel(text), null);
});

const run = (team_id, n, seconds, extra = {}) => ({ race_id: 'r', team_id, run: n, started_at: '2026-10-17T12:00:00Z', ended_at: '2026-10-17T12:01:00Z', seconds, ...extra });

test('slalom: o tempo conta do toque ou do fim dos 3 min depois da chegada anterior', () => {
  const end = 1_000_000;
  assert.equal(slalomStart(end + 60_000, null), end + 60_000);
  assert.equal(slalomStart(end + 60_000, end), end + 60_000);
  assert.equal(slalomStart(end + SLALOM_WINDOW + 20_000, end), end + SLALOM_WINDOW);
  // Muito depois dos 3 min é pausa na prova: conta do toque.
  assert.equal(slalomStart(end + SLALOM_WINDOW + 15 * 60_000, end), end + SLALOM_WINDOW + 15 * 60_000);
});

test('slalom: próxima tentativa livre, até 3', () => {
  assert.equal(nextAttempt([], 'a'), 1);
  assert.equal(nextAttempt([run('a', 1, 60), run('b', 1, 61)], 'a'), 2);
  assert.equal(nextAttempt([run('a', 1, 60), run('a', 3, null)], 'a'), 2);
  assert.equal(nextAttempt([run('a', 1, 60), run('a', 2, 61), run('a', 3, null)], 'a'), null);
});

test('barco na água: largou e ainda não chegou nem ficou sem tempo', () => {
  assert.equal(isRunning(run('a', 1, null, { ended_at: null })), true);
  assert.equal(isRunning(run('a', 1, null)), false);
  assert.equal(isRunning(run('a', 1, 58.4, { ended_at: null })), false);
  assert.equal(isRunning(run('a', 1, null, { started_at: null, ended_at: null })), false);
});

test('sprint: os 3 mais rápidos da bateria 1 vão para a bateria 2', () => {
  const heat = [run('a', 1, 50), run('b', 1, 48), run('c', 1, 52.5), run('d', 1, 55), run('e', 1, null), run('b', 2, 47)];
  assert.deepEqual(sprintFinalists(heat), ['b', 'a', 'c']);
  // Empate no 3º tempo: entram os dois.
  assert.deepEqual(sprintFinalists([...heat, run('f', 1, 52.5)]), ['b', 'a', 'c', 'f']);
});

test('diferença de tempo: segundos com décimo, ou minutos', () => {
  assert.equal(formatGap(1.26), '+1,3s');
  assert.equal(formatGap(0.6), '+0,6s');
  assert.equal(formatGap(62.4), '+1:02,4');
});
