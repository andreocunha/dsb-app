import sharp from 'sharp';
// Emenda duas faixas de 741px numa tela 9:16 e amplia para 1080x1920.
const [arqA, arqB, saida] = process.argv.slice(2);
const L = 645, H = 1146, FAIXA = 741, CORTE = H - FAIXA; // 405
const topo = await sharp(arqA).extract({ left: 0, top: 0, width: L, height: CORTE }).png().toBuffer();
const base = await sharp(arqB).png().toBuffer();
const tela = await sharp({ create: { width: L, height: H, channels: 3, background: '#ffffff' } })
  .composite([{ input: topo, top: 0, left: 0 }, { input: base, top: CORTE, left: 0 }])
  .png().toBuffer();
await sharp(tela).resize(1080, 1920, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(saida);
console.log('gerado', saida, '(1080x1920, 9:16)');
