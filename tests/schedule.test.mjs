import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, featured, phaseOf, phases, shiftOf, startsIn } from '../lib/schedule.ts';

const at = text => Date.parse(`${text}-03:00`);
const item = (over = {}) => ({
  key: 'race:r', kind: 'race', id: 'r', title: 'Raia Rápida', label: 'Prova 1', startsAt: at('2026-10-13T15:00'),
  startedAt: null, finishedAt: null, durationMinutes: 60, closingMinutes: 20, changes: [], ...over,
});

test('prova sem largada marcada: próxima, depois atrasada, e some no fim do dia', () => {
  assert.equal(phaseOf(item(), at('2026-10-13T14:59')).kind, 'upcoming');
  assert.deepEqual(phaseOf(item(), at('2026-10-13T15:10')), { kind: 'late', since: 10 * 60_000 });
  assert.equal(phaseOf(item(), at('2026-10-14T00:00')).kind, 'done');
});

test('prova com duração: relógio até o fim, depois a janela da última volta', () => {
  const race = item({ startedAt: at('2026-10-13T15:12') });
  assert.deepEqual(phaseOf(race, at('2026-10-13T15:30')), { kind: 'live', startedAt: race.startedAt, endsAt: at('2026-10-13T16:12') });
  assert.deepEqual(phaseOf(race, at('2026-10-13T16:20')), { kind: 'closing', limitAt: at('2026-10-13T16:32') });
  assert.equal(phaseOf(race, at('2026-10-13T16:32')).kind, 'done');
  assert.equal(phaseOf({ ...race, finishedAt: at('2026-10-13T15:40') }, at('2026-10-13T15:41')).kind, 'done');
});

test('prova sem duração fica ao vivo até a organização encerrar', () => {
  const race = item({ durationMinutes: null, startedAt: at('2026-10-14T10:05') });
  assert.equal(phaseOf(race, at('2026-10-14T13:00')).endsAt, null);
  assert.equal(phaseOf({ ...race, finishedAt: at('2026-10-14T13:00') }, at('2026-10-14T13:00')).kind, 'done');
});

test('item que não é prova vale por uma hora, ou até o próximo começar', () => {
  const event = item({ kind: 'event', key: 'event:a', label: '', title: 'Abertura oficial', startsAt: at('2026-10-13T14:00'), durationMinutes: null });
  assert.equal(phaseOf(event, at('2026-10-13T14:30')).kind, 'live');
  assert.equal(phaseOf(event, at('2026-10-13T15:00')).kind, 'done');
  const race = item({ startedAt: at('2026-10-13T14:40') });
  assert.equal(phases([race, event], at('2026-10-13T14:45'))[0].phase.kind, 'done');
});

test('card mostra a prova acontecendo, senão a atrasada, senão a próxima', () => {
  const r1 = item(), r2 = item({ key: 'race:r2', id: 'r2', label: 'Prova 2', startsAt: at('2026-10-14T10:00') });
  assert.equal(featured(phases([r1, r2], at('2026-10-13T12:00'))).item.key, 'race:r');
  assert.equal(featured(phases([r1, r2], at('2026-10-13T15:20'))).phase.kind, 'late');
  assert.equal(featured(phases([r1, r2], at('2026-10-13T23:59:59'))).item.key, 'race:r');
  assert.equal(featured(phases([r1, r2], at('2026-10-14T00:00'))).item.key, 'race:r2');
  assert.equal(featured(phases([r1, r2], at('2026-10-20T00:00'))).item.key, 'race:r2');
});

test('mudança de horário vira atrasada, antecipada ou remarcada em relação ao original', () => {
  const change = (previous, next, reason = '') => ({ previous_at: new Date(at(previous)).toISOString(), new_at: new Date(at(next)).toISOString(), reason, changed_at: '' });
  const delayed = item({ startsAt: at('2026-10-13T15:40'), changes: [change('2026-10-13T15:00', '2026-10-13T15:20', 'vento'), change('2026-10-13T15:20', '2026-10-13T15:40')] });
  assert.deepEqual(shiftOf(delayed), { kind: 'delayed', originalAt: at('2026-10-13T15:00'), reason: 'vento' });
  assert.equal(shiftOf(item({ startsAt: at('2026-10-13T14:30'), changes: [change('2026-10-13T15:00', '2026-10-13T14:30')] })).kind, 'earlier');
  assert.equal(shiftOf(item({ startsAt: at('2026-10-14T15:00'), changes: [change('2026-10-13T15:00', '2026-10-14T15:00')] })).kind, 'moved');
  // Voltou para o horário original: nada para mostrar.
  assert.equal(shiftOf(item({ changes: [change('2026-10-13T15:00', '2026-10-13T15:30'), change('2026-10-13T15:30', '2026-10-13T15:00')] })), null);
});

test('relógio e "falta quanto"', () => {
  assert.equal(clock(42 * 60_000 + 7_400), '42:08');
  assert.equal(clock(3_727_000), '1:02:07');
  assert.equal(clock(-5), '00:00');
  assert.equal(startsIn(30_000), 'em instantes');
  assert.equal(startsIn(25 * 60_000), 'em 25 min');
  assert.equal(startsIn(130 * 60_000), 'em 2h 10min');
  assert.equal(startsIn(3 * 24 * 3_600_000), 'em 3 dias');
});
