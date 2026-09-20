// Gera o "client secret" do Sign In with Apple: um JWT assinado com a chave .p8.
// O Supabase pede esse JWT (não o conteúdo do arquivo) no provedor Apple.
//
// Uso:
//   node scripts/apple-secret.mjs ~/Downloads/AuthKey_7SW5GPASD5.p8
//
// O segredo é gravado em apple-secret.txt (ignorado pelo git) em vez de aparecer
// na tela, para não vazar em histórico de terminal ou captura de tela.
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const TEAM_ID = '96TBL54DM8';
const SERVICES_ID = 'br.com.desafiosolar.app.signin';
const SEIS_MESES = 15777000; // máximo aceito pela Apple, em segundos

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Informe o caminho do .p8. Ex.: node scripts/apple-secret.mjs ~/Downloads/AuthKey_7SW5GPASD5.p8');
  process.exit(1);
}

// O Key ID está no nome do arquivo que a Apple gera (AuthKey_XXXXXXXXXX.p8).
const keyId = process.argv[3] ?? basename(arquivo).match(/AuthKey_([A-Z0-9]+)\.p8/)?.[1];
if (!keyId) {
  console.error('Não consegui descobrir o Key ID pelo nome do arquivo. Passe como segundo argumento.');
  process.exit(1);
}

const agora = Math.floor(Date.now() / 1000);
const base64url = valor => Buffer.from(JSON.stringify(valor)).toString('base64url');
const cabecalho = base64url({ alg: 'ES256', kid: keyId });
const corpo = base64url({
  iss: TEAM_ID,
  iat: agora,
  exp: agora + SEIS_MESES,
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID,
});

const assinador = createSign('SHA256');
assinador.update(`${cabecalho}.${corpo}`);
assinador.end();
// A Apple espera a assinatura no formato JOSE (r||s), não no DER padrão do OpenSSL.
const assinatura = assinador.sign({ key: readFileSync(arquivo), dsaEncoding: 'ieee-p1363' }).toString('base64url');

writeFileSync('apple-secret.txt', `${cabecalho}.${corpo}.${assinatura}\n`);
console.log('Segredo gravado em apple-secret.txt');
console.log('Team ID:     ', TEAM_ID);
console.log('Key ID:      ', keyId);
console.log('Services ID: ', SERVICES_ID);
console.log('Expira em:   ', new Date((agora + SEIS_MESES) * 1000).toLocaleDateString('pt-BR'));
