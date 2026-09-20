import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

/**
 * Login no app das lojas.
 * O Google recusa login feito dentro da tela do app, então a conta é escolhida no
 * navegador do sistema e a volta acontece por este deep link.
 */
export const isNativeApp = () => Capacitor.isNativePlatform();
export const APP_REDIRECT = 'dsbapp://login';

export async function nativeSignIn(provider: 'google' | 'apple') {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: APP_REDIRECT, skipBrowserRedirect: true, scopes: provider === 'apple' ? 'name email' : undefined },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Não foi possível abrir o login. Tente novamente.');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
}

/** Recebe o deep link de volta, troca o código pela sessão e fecha o navegador. */
export function listenNativeLogin(onDone: () => void) {
  if (!isNativeApp()) return () => {};
  const handle = import('@capacitor/app').then(({ App }) =>
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(APP_REDIRECT)) return;
      const params = new URL(url.replace('dsbapp://', 'https://dsbapp/')).searchParams;
      const code = params.get('code');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      const { Browser } = await import('@capacitor/browser');
      await Browser.close().catch(() => {});
      onDone();
    }));
  return () => { void handle.then(listener => listener.remove()); };
}
