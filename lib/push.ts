import { Capacitor } from '@capacitor/core';
import { supabase, errorMessage } from './supabase';

/**
 * Registra o aparelho para notificações (só no app das lojas).
 * Precisa do Firebase configurado nos projetos nativos; até lá fica desligado
 * por NEXT_PUBLIC_PUSH_ENABLED, porque o Android fecha o app sem o google-services.json.
 *
 * `avisar` recebe o motivo quando algo dá errado, para o problema aparecer na tela
 * em vez de ficar escondido no log do aparelho.
 */
export async function registerPush(avisar?: (mensagem: string) => void) {
  if (!Capacitor.isNativePlatform() || process.env.NEXT_PUBLIC_PUSH_ENABLED !== 'true') return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      avisar?.('Notificações desligadas. Para receber avisos das provas, libere nas configurações do aparelho.');
      return;
    }
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('register_push_device', { p_token: value, p_platform: Capacitor.getPlatform() });
      if (error) avisar?.(`Não consegui salvar este aparelho: ${errorMessage(error)}`);
    });
    await PushNotifications.addListener('registrationError', error => {
      avisar?.(`O Firebase recusou o registro: ${JSON.stringify(error)}`);
    });
    await PushNotifications.register();
  } catch (error) {
    avisar?.(`Notificações indisponíveis: ${errorMessage(error)}`);
  }
}
