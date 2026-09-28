import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketColumns, closingWindowMinutes, duelWinner, formatDuel, formatDuration, lapSplits, pointsIntensity, sortRace, sortStandings } from '../lib/scoring.ts';

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

test('chave completa as fases seguintes com duelos a definir', () => {
  const columns = bracketColumns([duel('qf', 1, 'a', 'b'), duel('qf', 2, 'c', 'd'), duel('qf', 4, 'g', 'h'), duel('sf', 1, 'a', 'c'), duel('third', 1, 'x', 'y')]);
  assert.deepEqual(columns.map(c => [c.stage, c.duels.length]), [['qf', 4], ['sf', 2], ['final', 1]]);
  assert.equal(columns[0].duels[2], null);
  assert.equal(columns[1].duels[1], null);
  assert.deepEqual(bracketColumns([]), []);
  // Antes do sorteio: 15 equipes pedem oitavas (16 vagas, uma passa direto).
  assert.deepEqual(bracketColumns([], 15).map(c => [c.stage, c.duels.length]), [['r16', 8], ['qf', 4], ['sf', 2], ['final', 1]]);
  assert.deepEqual(bracketColumns([], 8).map(c => c.stage), ['qf', 'sf', 'final']);
});

test('intensidade da cor vai de 50 a 150 pontos', () => {
  assert.equal(pointsIntensity(150), 1);
  assert.equal(pointsIntensity(100), .5);
  assert.equal(pointsIntensity(20), 0);
});
