import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullDate, onOpenNotification, openNotification, timeAgo, unreadCount } from '../lib/notifications.ts';

const at = text => Date.parse(`${text}-03:00`);
const iso = text => new Date(at(text)).toISOString();
const item = (id, when) => ({ id, kind: 'announcement', title: 't', body: null, image_url: null, created_at: iso(when) });

test('tempo curto no rodapé: agora, minutos, horas, ontem, data', () => {
  const now = at('2026-10-12T15:00');
  assert.equal(timeAgo(iso('2026-10-12T14:59:40'), now), 'agora');
  assert.equal(timeAgo(iso('2026-10-12T14:55'), now), 'há 5 min');
  assert.equal(timeAgo(iso('2026-10-12T12:00'), now), 'há 3 h');
  assert.equal(timeAgo(iso('2026-10-11T23:30'), now), 'ontem');
  assert.equal(timeAgo(iso('2026-10-03T10:00'), now), '3 out');
});

test('data completa no horário de Brasília', () => {
  assert.equal(fullDate(iso('2026-10-12T14:05')), '12 out, 14:05');
});

test('não lidas: depois do último visto e só dos últimos 7 dias', () => {
  const now = at('2026-10-12T15:00');
  const items = [item(4, '2026-10-12T14:00'), item(3, '2026-10-11T10:00'), item(2, '2026-10-01T10:00'), item(1, '2026-09-30T10:00')];
  assert.equal(unreadCount(items, 0, now), 2);
  assert.equal(unreadCount(items, 3, now), 1);
  assert.equal(unreadCount(items, 4, now), 0);
});

test('toque antes da home montar: o recado espera ela ouvir', () => {
  openNotification(7);
  const opened = [];
  const stop = onOpenNotification(id => opened.push(id));
  openNotification(8);
  stop();
  assert.deepEqual(opened, [7, 8]);
});
