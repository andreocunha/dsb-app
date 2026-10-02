import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accuracyLabel, asPlace, distance, distanceLabel, formatPlace, hasPlaceText, isSharing, liveUntilLabel, placeLabel, project, remainingLabel, tilesAround, updatedLabel } from '../lib/location.ts';

const NOW = new Date('2026-10-02T15:00:00Z').getTime();

test('lê o ponto salvo e ignora o que não é localização', () => {
  assert.deepEqual(asPlace({ lat: -22.9, lng: -43.2, accuracy: 12 }), { lat: -22.9, lng: -43.2, accuracy: 12 });
  assert.deepEqual(asPlace({ lat: 1, lng: 2, live_until: '2026-10-02T16:00:00Z' }), { lat: 1, lng: 2, live_until: '2026-10-02T16:00:00Z' });
  assert.equal(asPlace(null), null);
  assert.equal(asPlace({ lat: '1', lng: 2 }), null);
});

test('rótulo curto: o nome do lugar, fixa ou em tempo real', () => {
  assert.equal(placeLabel({ lat: 0, lng: 0 }), 'Localização');
  assert.equal(placeLabel({ lat: 0, lng: 0, name: 'Marina da Glória' }), 'Marina da Glória');
  assert.equal(hasPlaceText({ lat: 0, lng: 0 }), false);
  assert.equal(hasPlaceText({ lat: 0, lng: 0, address: 'Rua X' }), true);
  assert.equal(placeLabel({ lat: 0, lng: 0, live_until: '2026-10-02T16:00:00Z' }), 'Localização em tempo real');
});

test('em tempo real vale até o prazo; parar traz o prazo para agora', () => {
  const live = { lat: 0, lng: 0, live_until: '2026-10-02T15:30:00Z' };
  assert.equal(isSharing(live, NOW), true);
  assert.equal(isSharing(live, NOW + 31 * 60_000), false);
  assert.equal(isSharing({ lat: 0, lng: 0 }, NOW), false);
  assert.match(liveUntilLabel(live, NOW), /^Ativa até \d\d:\d\d$/);
  assert.equal(liveUntilLabel(live, NOW + 31 * 60_000), 'Localização em tempo real encerrada');
});

test('precisão como no WhatsApp', () => {
  assert.equal(accuracyLabel(12.4), 'Precisão de 12 metros');
  assert.equal(accuracyLabel(0.2), 'Precisão de 1 metro');
  assert.equal(accuracyLabel(1500), 'Precisão de 1,5 km');
  assert.equal(accuracyLabel(null), '');
});

test('última atualização e tempo restante', () => {
  assert.equal(updatedLabel(new Date(NOW - 20_000).toISOString(), NOW), 'Atualizada agora');
  assert.equal(updatedLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW), 'Atualizada há 5 min');
  assert.equal(updatedLabel(new Date(NOW - 125 * 60_000).toISOString(), NOW), 'Atualizada há 2 h');
  assert.match(updatedLabel(new Date(NOW - 7 * 3_600_000).toISOString(), NOW), /^Atualizada às \d\d:\d\d$/);
  assert.equal(remainingLabel(new Date(NOW + 14 * 60_000 + 10_000).toISOString(), NOW), '15 min restantes');
  assert.equal(remainingLabel(new Date(NOW + 60 * 60_000).toISOString(), NOW), '1 h restante');
  assert.equal(remainingLabel(new Date(NOW + 450 * 60_000).toISOString(), NOW), '7 h e 30 min restantes');
});

test('distância entre dois pontos', () => {
  // Cristo Redentor → Pão de Açúcar: uns 7,5 km em linha reta.
  const d = distance({ lat: -22.9519, lng: -43.2105 }, { lat: -22.9486, lng: -43.1566 });
  assert.ok(d > 5_400 && d < 5_700, String(d));
  assert.equal(distance({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('ladrilhos do mapa estático cobrem a janela em volta do ponto', () => {
  assert.deepEqual(project(0, 0, 0), { x: 128, y: 128 });
  const tiles = tilesAround(-22.9, -43.2, 15, 360, 220);
  assert.ok(tiles.length >= 2 && tiles.length <= 6);
  // O ponto fica dentro de um dos ladrilhos (dx <= 0 < dx + 256).
  assert.ok(tiles.some(t => t.dx <= 0 && t.dx + 256 > 0 && t.dy <= 0 && t.dy + 256 > 0));
  // Cobre a janela inteira.
  assert.ok(Math.min(...tiles.map(t => t.dx)) <= -180 && Math.max(...tiles.map(t => t.dx + 256)) >= 180);
});

test('endereço curto a partir da busca reversa, no jeito brasileiro', () => {
  assert.deepEqual(formatPlace({ name: '', address: { road: 'Rua Barata Ribeiro', house_number: '502', suburb: 'Copacabana', city: 'Rio de Janeiro', state: 'RJ' } }),
    { address: 'Rua Barata Ribeiro, 502 - Copacabana, Rio de Janeiro' });
  assert.deepEqual(formatPlace({ name: 'Marina da Glória', address: { road: 'Avenida Infante Dom Henrique', suburb: 'Glória', city: 'Rio de Janeiro' } }),
    { name: 'Marina da Glória', address: 'Avenida Infante Dom Henrique - Glória, Rio de Janeiro' });
  // Nome igual à rua não repete.
  assert.deepEqual(formatPlace({ name: 'Rua A', address: { road: 'Rua A', town: 'Búzios' } }), { address: 'Rua A, Búzios' });
  assert.deepEqual(formatPlace({ display_name: 'Baía de Guanabara, Rio de Janeiro, Brasil, 20000', address: {} }), { address: 'Baía de Guanabara, Rio de Janeiro, Brasil' });
  assert.equal(formatPlace(null), null);
});

test('distância até você', () => {
  assert.equal(distanceLabel(347), 'a 350 m de você');
  assert.equal(distanceLabel(2), 'a 1 m de você');
  assert.equal(distanceLabel(2430), 'a 2,4 km de você');
});
