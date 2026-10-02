import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, fold, formatMessage, hasMentionAll, jumboEmoji, listTime, mentionedIds, mentionQuery, mentionsMe, nameColor, NAME_COLORS, preview, whenLabel } from '../lib/chat-format.ts';

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

const people = [{ id: 'a', label: 'Ana' }, { id: 'b', label: 'Ana Paula' }, { id: 'c', label: 'Andre Cunha' }];

test('@Nome de quem está no grupo vira menção, preferindo o nome mais longo', () => {
  assert.deepEqual(formatMessage('oi @andre cunha!', people), [text('oi '), { type: 'mention', text: 'andre cunha', id: 'c' }, text('!')]);
  assert.deepEqual(formatMessage('@Ana Paula e @Ana', people), [{ type: 'mention', text: 'Ana Paula', id: 'b' }, text(' e '), { type: 'mention', text: 'Ana', id: 'a' }]);
  assert.deepEqual(formatMessage('*@Ana*', people), [{ type: 'bold', children: [{ type: 'mention', text: 'Ana', id: 'a' }] }]);
});

test('@ sem pessoa, colado em palavra ou no meio de um nome não marca', () => {
  assert.deepEqual(formatMessage('@Fulano', people), [text('@Fulano')]);
  assert.deepEqual(formatMessage('ana@ana.com', people), [text('ana@ana.com')]);
  assert.deepEqual(formatMessage('@Anabela', people), [text('@Anabela')]);
  assert.deepEqual(formatMessage('@Ana'), [text('@Ana')]);
});

test('quem foi marcado vai junto com a mensagem, sem repetir e sem contar código', () => {
  assert.deepEqual(mentionedIds('@Ana e *@Andre Cunha*, de novo @ana e `@Ana Paula`', people), ['a', 'c']);
  assert.deepEqual(mentionedIds('sem ninguém', people), []);
});

test('o @ que está sendo digitado', () => {
  assert.deepEqual(mentionQuery('oi @', 4), { start: 3, query: '' });
  assert.deepEqual(mentionQuery('oi @Andre Cu', 12), { start: 3, query: 'Andre Cu' });
  assert.deepEqual(mentionQuery('@est tudo', 4), { start: 0, query: 'est' });
  assert.equal(mentionQuery('email@x', 7), null);
  assert.equal(mentionQuery('@Andre Cunha ', 13), null);
  assert.equal(mentionQuery('@a\nb', 4), null);
  assert.equal(fold('Estevão'), 'estevao');
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

test('horário da lista de conversas: hora hoje, depois ontem e datas', () => {
  const now = new Date(2026, 8, 30, 18, 0);
  assert.equal(listTime(new Date(2026, 8, 30, 14, 31).toISOString(), now), '14:31');
  assert.equal(listTime(new Date(2026, 8, 29, 9, 8).toISOString(), now), 'Ontem');
  assert.equal(listTime(new Date(2026, 8, 20, 9, 8).toISOString(), now), '20/09/2026');
});

test('@all: palavra solta no texto, e conta como menção a todo mundo menos quem mandou', () => {
  assert.equal(hasMentionAll('@all bora!'), true);
  assert.equal(hasMentionAll('Atenção @ALL, prova às 14h'), true);
  assert.equal(hasMentionAll('oi (@all)'), true);
  assert.equal(hasMentionAll('@allan tudo bem?'), false);
  assert.equal(hasMentionAll('mande para e-mail@all.com'), false);
  assert.equal(hasMentionAll('all sem arroba'), false);
  assert.equal(mentionsMe({ user_id: 'a', mentions: [], mention_all: true }, 'b'), true);
  assert.equal(mentionsMe({ user_id: 'b', mentions: [], mention_all: true }, 'b'), false);
  assert.equal(mentionsMe({ user_id: 'a', mentions: ['b'] }, 'b'), true);
  assert.equal(mentionsMe({ user_id: 'a', mentions: ['c'], mention_all: false }, 'b'), false);
  assert.equal(mentionsMe({ user_id: 'a', mentions: [], mention_all: true }, null), false);
  assert.deepEqual(formatMessage('@all bora', [{ id: 'all', label: 'all' }])[0], { type: 'mention', text: 'all', id: 'all' });
});
