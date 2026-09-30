import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, formatMessage, jumboEmoji, nameColor, NAME_COLORS, preview, whenLabel } from '../lib/chat-format.ts';

const text = t => ({ type: 'text', text: t });

test('negrito, itálico e riscado como no WhatsApp', () => {
  assert.deepEqual(formatMessage('vai *Solaris*!'), [text('vai '), { type: 'bold', children: [text('Solaris')] }, text('!')]);
  assert.deepEqual(formatMessage('_a_ ~b~'), [{ type: 'italic', children: [text('a')] }, text(' '), { type: 'strike', children: [text('b')] }]);
  assert.deepEqual(formatMessage('*muito _bom_*'), [{ type: 'bold', children: [text('muito '), { type: 'italic', children: [text('bom')] }] }]);
});

test('marcador colado em palavra ou com espaço não formata', () => {
  assert.deepEqual(formatMessage('snake_case_nome'), [text('snake_case_nome')]);
  assert.deepEqual(formatMessage('2*3*4'), [text('2*3*4')]);
  assert.deepEqual(formatMessage('* solto *'), [text('* solto *')]);
  assert.deepEqual(formatMessage('*quebra\nlinha*'), [text('*quebra\nlinha*')]);
});

test('código e bloco monoespaçado não recebem outra formatação', () => {
  assert.deepEqual(formatMessage('use `*x*` aqui'), [text('use '), { type: 'code', text: '*x*' }, text(' aqui')]);
  assert.deepEqual(formatMessage('```\n*a*\n```'), [{ type: 'mono', text: '\n*a*\n' }]);
});

test('links viram clicáveis, sem a pontuação do fim', () => {
  assert.deepEqual(formatMessage('veja www.dsb.app.br.'), [text('veja '), { type: 'link', text: 'www.dsb.app.br', href: 'https://www.dsb.app.br' }, text('.')]);
  assert.deepEqual(formatMessage('*https://x.com/a*'), [{ type: 'bold', children: [{ type: 'link', text: 'https://x.com/a', href: 'https://x.com/a' }] }]);
});

test('de 1 a 3 emojis sozinhos ficam grandes', () => {
  assert.equal(jumboEmoji('☀️'), 1);
  assert.equal(jumboEmoji('🚤 🔥'), 2);
  assert.equal(jumboEmoji('👍🏽🇧🇷👨‍👩‍👧'), 3);
  assert.equal(jumboEmoji('🔥🔥🔥🔥'), 0);
  assert.equal(jumboEmoji('oi 🔥'), 0);
  assert.equal(jumboEmoji('123'), 0);
  assert.equal(jumboEmoji(null), 0);
});

test('selo de data: hoje, ontem, dia da semana e data', () => {
  const now = new Date(2026, 8, 30, 10, 0); // quarta-feira
  assert.equal(dayLabel(new Date(2026, 8, 30, 0, 5).toISOString(), now), 'Hoje');
  assert.equal(dayLabel(new Date(2026, 8, 29, 23, 59).toISOString(), now), 'Ontem');
  assert.equal(dayLabel(new Date(2026, 8, 27, 12).toISOString(), now), 'Domingo');
  assert.equal(dayLabel(new Date(2026, 8, 23, 12).toISOString(), now), '23/09/2026');
  assert.match(whenLabel(new Date(2026, 8, 30, 14, 32).toISOString(), now), /^hoje às 14:32$/);
  assert.match(whenLabel(new Date(2026, 8, 1, 9, 5).toISOString(), now), /^01\/09\/2026 às 09:05$/);
});

test('Ler mais só aparece em textos longos e não corta palavra', () => {
  assert.equal(preview('curto'), null);
  const long = 'palavra '.repeat(120);
  const cut = preview(long);
  assert.ok(cut.length < long.length);
  assert.match(cut, /palavra…$/);
});

test('cor do nome é estável e dentro da paleta', () => {
  const id = '6f1c2d6e-8a61-4c1f-9d7e-1b2a3c4d5e6f';
  assert.equal(nameColor(id), nameColor(id));
  assert.ok(nameColor(id) >= 0 && nameColor(id) < NAME_COLORS);
});
