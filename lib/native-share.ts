import { Capacitor } from '@capacitor/core';

/**
 * Compartilhar e baixar dentro do app das lojas.
 * O WebView não tem navigator.share no Android nem baixa link com `download` em nenhum dos
 * dois sistemas, então no app o arquivo vai para o cache e abre a folha de compartilhamento
 * do sistema, que já oferece "Salvar imagem", Fotos, Arquivos e as redes sociais.
 *
 * Só vale a partir da 1.0.2: as versões anteriores carregam este mesmo site sem os plugins,
 * e nelas o comportamento do navegador continua.
 */
export const isNativeApp = () =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share') && Capacitor.isPluginAvailable('Filesystem');

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// Nome seguro para o sistema de arquivos, mantendo a extensão.
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'arquivo';

type Source = { blob?: Blob; url?: string; name: string };

// Grava no cache do app e devolve o endereço do arquivo, que os plugins nativos sabem abrir.
async function toCacheFile({ blob, url, name }: Source) {
  if (!blob) {
    const response = await fetch(url ?? '');
    if (!response.ok) throw new Error(`Falha ao baixar o arquivo (${response.status}).`);
    blob = await response.blob();
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { uri } = await Filesystem.writeFile({ path: safeName(name), data: await toBase64(blob), directory: Directory.Cache });
  return uri;
}

/** Abre a folha de compartilhamento do sistema com o arquivo (o blob, ou o que estiver no endereço). */
export async function shareNativeFile(source: Source & { title?: string }) {
  const [uri, { Share }] = await Promise.all([toCacheFile(source), import('@capacitor/share')]);
  try {
    await Share.share({ title: source.title, files: [uri] });
  } catch (error) {
    // Fechar a folha sem escolher nada também cai aqui; não é erro para a pessoa.
    if (!/cancel/i.test(String((error as Error)?.message ?? error))) throw error;
  }
}

export const canSaveToGallery = () => isNativeApp() && Capacitor.isPluginAvailable('Media');

const ALBUM = 'DSB';

/**
 * Salva a foto ou o vídeo direto na galeria, num álbum "DSB". A folha de compartilhamento do Android
 * não tem "Salvar imagem" (a do iPhone tem), então o app oferece o botão nos dois.
 */
export async function saveToGallery(source: Source, kind: 'photo' | 'video' = 'photo') {
  const [uri, { Media }] = await Promise.all([toCacheFile(source), import('@capacitor-community/media')]);
  let albumIdentifier: string | undefined;
  // No Android o álbum é obrigatório: usa o do app, criando na primeira vez.
  if (Capacitor.getPlatform() === 'android') {
    const find = async () => (await Media.getAlbums()).albums.find(album => album.name === ALBUM)?.identifier;
    albumIdentifier = await find();
    if (!albumIdentifier) { await Media.createAlbum({ name: ALBUM }); albumIdentifier = await find(); }
  }
  const options = { path: uri, albumIdentifier, fileName: source.name.replace(/\.\w+$/, '') };
  await (kind === 'video' ? Media.saveVideo(options) : Media.savePhoto(options));
}

/** Compartilha um link com texto. No app usa a folha do sistema; no site, a do navegador. Devolve false se não houver como. */
export async function shareLink(data: { title: string; text: string; url: string }) {
  try {
    if (isNativeApp()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ ...data, dialogTitle: data.title });
      return true;
    }
    if (!navigator.share) return false;
    await navigator.share(data);
  } catch { /* a pessoa cancelou o compartilhamento */ }
  return true;
}
