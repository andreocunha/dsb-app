import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeEmbedUrl } from '../lib/event-config.ts';
const id = 'M7lc1UVf-VE';
test('converte formatos públicos do YouTube para o player', () => {
  for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}?si=example`, `https://youtube.com/live/${id}`, `https://www.youtube.com/embed/${id}`, `https://m.youtube.com/watch?v=${id}`]) {
    assert.equal(youtubeEmbedUrl(url), `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`);
  }
});
test('não incorpora links inválidos, outras origens ou URLs inseguras', () => {
  for (const url of ['', 'ainda não anunciado', `https://youtube.com.evil.test/watch?v=${id}`, `http://youtube.com/watch?v=${id}`, 'javascript:alert(1)', 'https://youtube.com/watch?v=invalido']) assert.equal(youtubeEmbedUrl(url), null);
});
