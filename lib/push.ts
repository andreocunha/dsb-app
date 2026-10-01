import { Capacitor } from '@capacitor/core';
import { supabase, errorMessage } from './supabase';

const enabled = () => Capacitor.isNativePlatform() && process.env.NEXT_PUBLIC_PUSH_ENABLED === 'true';

/**
 * Registra o aparelho para notificações (só no app das lojas).
 * Precisa do Firebase configurado nos projetos nativos; até lá fica desligado
 * por NEXT_PUBLIC_PUSH_ENABLED, porque o Android fecha o app sem o google-services.json.
 *
 * `avisar` recebe o motivo quando algo dá errado, para o problema aparecer na tela
 * em vez de ficar escondido no log do aparelho. `abrir` recebe a conversa da notificação
 * tocada ("geral" ou o id da particular), inclusive quando o toque é que abriu o app.
 */
export async function registerPush(avisar?: (mensagem: string) => void, abrir?: (conversa: string) => void) {
  if (!enabled()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      avisar?.('Notificações desligadas. Para receber avisos das provas e mensagens, libere nas configurações do aparelho.');
      return;
    }
    // No Android cada canal vira um interruptor separado nas configurações do app.
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({ id: 'mensagens', name: 'Mensagens', description: 'Conversas particulares, respostas e menções no grupo', importance: 5, visibility: 0, vibration: true });
      await PushNotifications.createChannel({ id: 'dsb', name: 'Avisos das provas', description: 'Largadas e lembretes do fantasy', importance: 4, visibility: 1 });
    }
    await PushNotifications.removeAllListeners();
    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('register_push_device', { p_token: value, p_platform: Capacitor.getPlatform() });
      if (error) avisar?.(`Não consegui salvar este aparelho: ${errorMessage(error)}`);
    });
    await PushNotifications.addListener('registrationError', error => {
      avisar?.(`O Firebase recusou o registro: ${JSON.stringify(error)}`);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversa = notification.data?.c;
      if (typeof conversa === 'string' && conversa) abrir?.(conversa);
    });
    await PushNotifications.register();
  } catch (error) {
    avisar?.(`Notificações indisponíveis: ${errorMessage(error)}`);
  }
}

/** Tira da bandeja as notificações de uma conversa que acabou de ser lida, como no WhatsApp. */
export async function clearChatNotifications(conversa: string) {
  if (!enabled()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { notifications } = await PushNotifications.getDeliveredNotifications();
    // Android devolve a tag (que é a conversa); iOS devolve os dados que foram junto.
    const daConversa = notifications.filter(n => n.tag === conversa || n.data?.c === conversa);
    if (daConversa.length) await PushNotifications.removeDeliveredNotifications({ notifications: daConversa });
  } catch { /* bandeja indisponível: as notificações ficam até a pessoa dispensar */ }
}
