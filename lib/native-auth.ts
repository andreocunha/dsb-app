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

/**
 * Recebe o deep link de volta, troca o código pela sessão e fecha o navegador.
 * `onDone` recebe o motivo quando o login não deu certo — sem isso o app voltava
 * da tela do provedor calado, e a pessoa só via que continuava deslogada.
 */
export function listenNativeLogin(onDone: (erro?: string) => void) {
  if (!isNativeApp()) return () => {};
  const handle = import('@capacitor/app').then(({ App }) =>
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(APP_REDIRECT)) return;
      // O erro pode vir na query ou no fragmento, dependendo do provedor.
      const volta = new URL(url.replace('dsbapp://', 'https://dsbapp/'));
      const params = new URLSearchParams(`${volta.searchParams}&${volta.hash.replace(/^#/, '')}`);
      let erro = params.get('error_description') ?? params.get('error') ?? undefined;
      const code = params.get('code');
      if (!erro && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) erro = error.message;
      } else if (!erro && !code) {
        erro = 'O provedor não devolveu o código de acesso.';
      }
      const { Browser } = await import('@capacitor/browser');
      await Browser.close().catch(() => {});
      onDone(erro);
    }));
  return () => { void handle.then(listener => listener.remove()); };
}
