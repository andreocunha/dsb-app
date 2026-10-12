import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceFromUserAgent } from '../lib/device.ts';

test('app Android: modelo e versão do sistema', () => {
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36'),
    { model: 'SM-A546E', os: 'Android 14' });
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Linux; Android 13; moto g(30) Build/T2RC33.18; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36'),
    { model: 'moto g(30)', os: 'Android 13' });
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Linux; Android 8.1.0; Redmi 5 Plus) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.0.0 Mobile Safari/537.36'),
    { model: 'Redmi 5 Plus', os: 'Android 8.1.0' });
});

test('Android sem modelo: Chrome reduzido, WebView sem modelo e Firefox', () => {
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'),
    { model: null, os: 'Android' });
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'),
    { model: null, os: 'Android 15' });
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0'),
    { model: null, os: 'Android 14' });
});

test('iPhone e iPad: só a família e a versão do iOS', () => {
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
    { model: 'iPhone', os: 'iOS 18.5' });
  assert.deepEqual(
    deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
    { model: 'iPad', os: 'iOS 17.5.1' });
});

test('computador: só o sistema', () => {
  assert.deepEqual(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'), { model: null, os: 'Windows' });
  assert.deepEqual(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'), { model: null, os: 'macOS' });
  assert.deepEqual(deviceFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'), { model: null, os: 'Linux' });
  assert.deepEqual(deviceFromUserAgent(''), { model: null, os: null });
});
