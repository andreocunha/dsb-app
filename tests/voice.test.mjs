import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, toWaveform, WAVE_BARS } from '../lib/voice.ts';

test('duração no formato do WhatsApp', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(7_400), '0:07');
  assert.equal(formatDuration(83_000), '1:23');
  assert.equal(formatDuration(3_600_000), '60:00');
});

test('forma de onda: sempre 60 barras de 0 a 100, com o pico de cada trecho', () => {
  const wave = toWaveform([0, 10, 50, 10, 0, 100, 0, 0, 25, 25]);
  assert.equal(wave.length, WAVE_BARS);
  assert.ok(wave.every(v => v >= 6 && v <= 100));
  assert.equal(Math.max(...wave), 100);
});

test('forma de onda de gravação longa reduz pelo pico, sem perder os picos', () => {
  const levels = Array.from({ length: 6000 }, (_, i) => (i === 3000 ? 90 : 9));
  const wave = toWaveform(levels);
  assert.equal(wave.length, WAVE_BARS);
  assert.equal(wave.filter(v => v === 100).length, 1);
});

test('sem medições (gravação muda) a onda fica baixa e uniforme', () => {
  assert.deepEqual(toWaveform([]), Array(WAVE_BARS).fill(8));
});
