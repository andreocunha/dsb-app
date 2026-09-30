import { Capacitor } from '@capacitor/core';

/**
 * Deixa a barra de status com a mesma cor do app e os ícones legíveis.
 * A cor vem dos tokens de theme.css, para não existir um segundo lugar com as cores.
 */
export async function paintStatusBar(theme: string) {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  const escuro = theme === 'dark';
  try {
    if (Capacitor.getPlatform() === 'android') {
      // O app desenha por baixo da barra de status em todas as versões, como já acontece
      // sozinho no Android 15+. Com `overlay: false`, no Android 8–14 a página começava
      // abaixo da barra E ainda recuava o espaço do notch: sobrava uma faixa em branco.
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: escuro ? Style.Dark : Style.Light });
      watchNavigationBar();
      return;
    }
    await StatusBar.setOverlaysWebView({ overlay: false });
    // Style.Light = fundo claro, ícones escuros. Era isso que faltava no tema claro.
    await StatusBar.setStyle({ style: escuro ? Style.Dark : Style.Light });
  } catch {
    // Em algumas versões do iOS a cor de fundo não é ajustável; o estilo já basta.
  }
}

let navWatched = false;
/**
 * No Android 8–14 a barra de botões fica fora do app, mas o sistema ainda informa a altura
 * dela como área segura. Quando a página não chega até o fim da tela, o recuo de baixo é
 * zerado (html.nav-solida) para não sobrar uma faixa vazia acima dos botões.
 */
function watchNavigationBar() {
  if (navWatched) return;
  navWatched = true;
  const check = () => {
    const faltando = window.screen.height - window.innerHeight;
    // Teclado aberto também encolhe a página; nesse caso a barra de baixo fica escondida mesmo.
    document.documentElement.classList.toggle('nav-solida', faltando > 24);
  };
  check();
  window.addEventListener('resize', check);
}

/**
 * Esconde a tela de abertura, que fica segurada até aqui (`launchAutoHide: false`).
 * Sem isso o app mostra a splash, apaga, e deixa um retângulo da cor de fundo no ar
 * enquanto o site carrega. Chamar quando a interface já tem o que mostrar.
 */
export async function hideSplash() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    // Some sozinha pelo launchFadeOutDuration: melhor do que arriscar travar o app aqui.
  }
}

/** Botão físico de voltar do Android. */
export function listenBackButton(onBack: () => void) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = import('@capacitor/app').then(({ App }) => App.addListener('backButton', onBack));
  return () => { void handle.then(listener => listener.remove()); };
}
