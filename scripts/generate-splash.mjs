import sharp from 'sharp';

// Telas de abertura nativas a partir de assets/splash*.png.
//
// O arquivo de origem tem o logo pequeno no meio de muito fundo. Como a tela é exibida
// inteira (scaleAspectFit no LaunchScreen.storyboard), esse fundo vira margem morta e o
// logo aparece minúsculo. Aqui o logo é recortado do fundo e redesenhado na proporção que
// se quer ver em tela, sobre o roxo da marca.
const FUNDO = { claro: '#422378', escuro: '#1c1030' };
const LADO = 2732;
// Fração da largura da tela ocupada pelo logo. Acima de ~0,7 fica apertado em tela estreita.
const LARGURA_DO_LOGO = 0.62;

for (const [tema, fonte] of [['claro', 'assets/splash.png'], ['escuro', 'assets/splash-dark.png']]) {
  const logo = await sharp(fonte)
    .trim()                                             // tira o fundo sólido em volta
    .resize({ width: Math.round(LADO * LARGURA_DO_LOGO), fit: 'inside' })
    .toBuffer();
  const { width, height } = await sharp(logo).metadata();
  await sharp({ create: { width: LADO, height: LADO, channels: 3, background: FUNDO[tema] } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(`/tmp/splash-${tema}.png`);
  const sufixo = tema === 'escuro' ? '-dark' : '';
  for (const escala of ['1x', '2x', '3x']) {
    await sharp(`/tmp/splash-${tema}.png`).toFile(`ios/App/App/Assets.xcassets/Splash.imageset/Default@${escala}~universal~anyany${sufixo}.png`);
  }
  console.log(`splash ${tema}: logo ${width}x${height} (${Math.round(LARGURA_DO_LOGO * 100)}% da largura) sobre ${FUNDO[tema]}`);
}
