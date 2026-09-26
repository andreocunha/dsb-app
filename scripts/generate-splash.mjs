import sharp from 'sharp';

// Telas de abertura nativas a partir de assets/splash*.png.
//
// A imagem é quadrada e o iOS a exibe preenchendo a tela, então num celular alto só a faixa
// central da largura aparece — num iPhone 17 Pro, cerca de 46%. Com o logo ocupando quase
// metade da imagem, as pontas ficavam cortadas ("11 a 18 de outubr", "Imboassic").
// A saída é dar margem: o logo entra reduzido, e o que sobra é o roxo da marca.
const FUNDO = { claro: '#422378', escuro: '#1c1030' };
const LADO = 2732;
const ESCALA = 0.55;

for (const [tema, fonte] of [['claro', 'assets/splash.png'], ['escuro', 'assets/splash-dark.png']]) {
  const logo = await sharp(fonte).resize(Math.round(LADO * ESCALA), Math.round(LADO * ESCALA), { fit: 'inside' }).toBuffer();
  const tela = await sharp({ create: { width: LADO, height: LADO, channels: 3, background: FUNDO[tema] } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 }).toBuffer();
  const sufixo = tema === 'escuro' ? '-dark' : '';
  for (const escala of ['1x', '2x', '3x']) {
    await sharp(tela).toFile(`ios/App/App/Assets.xcassets/Splash.imageset/Default@${escala}~universal~anyany${sufixo}.png`);
  }
  console.log(`splash ${tema}: logo a ${Math.round(ESCALA * 100)}% sobre ${FUNDO[tema]}`);
}
