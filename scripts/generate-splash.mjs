import sharp from 'sharp';
import { readdir } from 'node:fs/promises';

// Telas de abertura nativas a partir de assets/splash*.png.
//
// O arquivo de origem tem o logo pequeno no meio de muito fundo, e essa folga aparecia como
// margem morta: o logo saía minúsculo. Aqui ele é recortado do fundo e redesenhado na
// proporção que se quer ver, sobre o roxo da marca.
//
// No iOS a imagem é quadrada (o sistema a encaixa inteira na tela). No Android cada
// densidade e orientação tem o seu tamanho, e a imagem é usada pelo @capacitor/splash-screen
// depois da tela que o próprio sistema desenha.
const FUNDO = { claro: '#422378', escuro: '#1c1030' };
const IOS_LADO = 2732;
const LARGURA_DO_LOGO = 0.62;   // fração da largura, no iOS
const ANDROID = { largura: 0.70, altura: 0.34 };   // limites no Android, o menor manda

const fontes = { claro: 'assets/splash.png', escuro: 'assets/splash-dark.png' };
const logos = {};
for (const [tema, fonte] of Object.entries(fontes)) {
  logos[tema] = await sharp(fonte).trim().toBuffer();   // tira o fundo sólido em volta
}
const proporcao = await sharp(logos.claro).metadata().then(m => m.width / m.height);

async function desenhar(largura, altura, tema, destino) {
  const larguraLogo = Math.round(Math.min(largura * ANDROID.largura, altura * ANDROID.altura * proporcao));
  const logo = await sharp(logos[tema]).resize({ width: larguraLogo, fit: 'inside' }).toBuffer();
  await sharp({ create: { width: largura, height: altura, channels: 3, background: FUNDO[tema] } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(destino);
}

// iOS: uma imagem quadrada serve todos os aparelhos.
for (const tema of ['claro', 'escuro']) {
  const logo = await sharp(logos[tema]).resize({ width: Math.round(IOS_LADO * LARGURA_DO_LOGO), fit: 'inside' }).toBuffer();
  const tela = await sharp({ create: { width: IOS_LADO, height: IOS_LADO, channels: 3, background: FUNDO[tema] } })
    .composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
  const sufixo = tema === 'escuro' ? '-dark' : '';
  for (const escala of ['1x', '2x', '3x']) {
    await sharp(tela).toFile(`ios/App/App/Assets.xcassets/Splash.imageset/Default@${escala}~universal~anyany${sufixo}.png`);
  }
}
console.log(`iOS: logo a ${Math.round(LARGURA_DO_LOGO * 100)}% da largura, ${IOS_LADO}x${IOS_LADO}`);

// Android: mantém o tamanho que cada pasta de densidade já tinha.
const base = 'android/app/src/main/res';
let contagem = 0;
for (const pasta of (await readdir(base)).filter(d => d.startsWith('drawable'))) {
  const arquivo = `${base}/${pasta}/splash.png`;
  const meta = await sharp(arquivo).metadata().catch(() => null);
  if (!meta) continue;
  await desenhar(meta.width, meta.height, pasta.includes('night') ? 'escuro' : 'claro', arquivo);
  contagem++;
}
console.log(`Android: ${contagem} arquivos regerados (logo até ${Math.round(ANDROID.largura * 100)}% da largura)`);

// Ícone da tela que o próprio Android desenha (Android 12+). Precisa ser transparente:
// o ic_launcher_foreground tem fundo roxo opaco, num tom que não bate com o do sistema,
// e aparecia um quadrado atrás do símbolo. A margem vai na imagem, porque o sistema
// mascara as bordas.
const ICONE = 'public/images/logo-transparente.png';
// O sistema recorta esta imagem num círculo menor que ela: a arte precisa caber num raio
// de ~0,42 do lado, senão os cantos somem (a 0,60 o "L" de BRASIL era cortado).
const ARTE = 0.5;
for (const [pasta, lado] of [['mdpi', 288], ['hdpi', 432], ['xhdpi', 576], ['xxhdpi', 864], ['xxxhdpi', 1152]]) {
  const arte = await sharp(ICONE).trim().resize({ width: Math.round(lado * ARTE), height: Math.round(lado * ARTE), fit: 'inside' }).toBuffer();
  await sharp({ create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: arte, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(`${base}/drawable-${pasta}/splash_icon.png`);
}
console.log(`Android: ícone da abertura em 5 densidades, arte a ${Math.round(ARTE * 100)}% e fundo transparente`);
