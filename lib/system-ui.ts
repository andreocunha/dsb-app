import { Capacitor } from '@capacitor/core';

/**
 * Deixa a barra de status com a mesma cor do app e os ícones legíveis.
 * A cor vem dos tokens de theme.css, para não existir um segundo lugar com as cores.
 */
export async function paintStatusBar(theme: string) {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  const escuro = theme === 'dark';
  const cor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || (escuro ? '#211b2a' : '#ffffff');
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    // Style.Light = fundo claro, ícones escuros. Era isso que faltava no tema claro.
    await StatusBar.setStyle({ style: escuro ? Style.Dark : Style.Light });
    if (Capacitor.getPlatform() === 'android') await StatusBar.setBackgroundColor({ color: cor });
  } catch {
    // Em algumas versões do iOS a cor de fundo não é ajustável; o estilo já basta.
  }
}

/** Botão físico de voltar do Android. */
export function listenBackButton(onBack: () => void) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handle = import('@capacitor/app').then(({ App }) => App.addListener('backButton', onBack));
  return () => { void handle.then(listener => listener.remove()); };
}
