import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closesIn, lineupPoints, pickPoints } from '../lib/fantasy.ts';

const results = [
  { race_id: 'r1', team_id: 'a', points: 150 },
  { race_id: 'r1', team_id: 'b', points: 100 },
  { race_id: 'r2', team_id: 'a', points: 50 },
];

test('turbo solar dobra só o barco marcado', () => {
  const lineup = { team_ids: ['a', 'b', 'c'], double_team_id: 'b' };
  assert.equal(pickPoints(lineup, results, 'r1', 'a'), 150);
  assert.equal(pickPoints(lineup, results, 'r1', 'b'), 200);
  assert.equal(pickPoints(lineup, results, 'r1', 'c'), undefined);
  assert.equal(lineupPoints(lineup, results, 'r1'), 350);
});

test('escalação sem turbo e sem resultado', () => {
  assert.equal(lineupPoints({ team_ids: ['a'], double_team_id: null }, results, 'r2'), 50);
  assert.equal(lineupPoints({ team_ids: ['a', 'b'], double_team_id: 'a' }, results, 'r3'), 0);
});

test('contagem até a largada', () => {
  const min = 60_000;
  assert.equal(closesIn(30_000), 'menos de 1 min');
  assert.equal(closesIn(12 * min), '12 min');
  assert.equal(closesIn(60 * min), '1h');
  assert.equal(closesIn(200 * min), '3h 20min');
  assert.equal(closesIn((2 * 1440 + 4 * 60 + 30) * min), '2d 4h');
  assert.equal(closesIn(3 * 1440 * min), '3d');
});
