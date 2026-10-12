import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase, errorMessage } from './supabase';

const enabled = () => Capacitor.isNativePlatform() && process.env.NEXT_PUBLIC_PUSH_ENABLED === 'true';

/** granted: liberadas; ask: o sistema ainda mostra a pergunta; denied: agora só pelos ajustes do aparelho. */
export type PushPermission = 'granted' | 'ask' | 'denied';
const permissionOf = (receive: string): PushPermission => receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'ask';

// Guardados para as Configurações poderem refazer o registro sem perder o toque nas notificações.
let avisos: ((mensagem: string) => void) | undefined;
let aoAbrir: ((conversa: string) => void) | undefined;

/** Como este aparelho está para receber notificações; null fora do app das lojas. */
export async function pushPermission(): Promise<PushPermission | null> {
  if (!enabled()) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    return permissionOf((await PushNotifications.checkPermissions()).receive);
  } catch { return null; }
}

/** Com a permissão dada: canais, ouvintes e o registro do aparelho na conta. */
async function register() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  // No Android cada canal vira um interruptor separado nas configurações do app.
  if (Capacitor.getPlatform() === 'android') {
    await PushNotifications.createChannel({ id: 'mensagens', name: 'Mensagens', description: 'Conversas particulares, grupos, respostas e menções', importance: 5, visibility: 0, vibration: true });
    await PushNotifications.createChannel({ id: 'dsb', name: 'Avisos das provas', description: 'Largadas e lembretes do fantasy', importance: 4, visibility: 1 });
  }
  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener('registration', async ({ value }) => {
    const { error } = await supabase.rpc('register_push_device', { p_token: value, p_platform: Capacitor.getPlatform() });
    if (error) avisos?.(`Não consegui salvar este aparelho: ${errorMessage(error)}`);
  });
  await PushNotifications.addListener('registrationError', error => {
    avisos?.(`O Firebase recusou o registro: ${JSON.stringify(error)}`);
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const conversa = notification.data?.c;
    if (typeof conversa === 'string' && conversa) aoAbrir?.(conversa);
  });
  await PushNotifications.register();
}

/**
 * Registra o aparelho para notificações (só no app das lojas).
 * Precisa do Firebase configurado nos projetos nativos; até lá fica desligado
 * por NEXT_PUBLIC_PUSH_ENABLED, porque o Android fecha o app sem o google-services.json.
 *
 * `avisar` recebe o motivo quando algo dá errado, para o problema aparecer na tela
 * em vez de ficar escondido no log do aparelho. `abrir` recebe a conversa da notificação
 * tocada ("geral" ou o id da particular), inclusive quando o toque é que abriu o app.
 *
 * Devolve como ficou a permissão: quem recusou a pergunta do sistema reativa pelas Configurações.
 */
export async function registerPush(avisar?: (mensagem: string) => void, abrir?: (conversa: string) => void): Promise<PushPermission | null> {
  if (!enabled()) return null;
  avisos = avisar; aoAbrir = abrir;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
    if (permission.receive === 'granted') await register();
    return permissionOf(permission.receive);
  } catch (error) {
    avisar?.(`Notificações indisponíveis: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * A pedido da pessoa (Configurações): pergunta de novo enquanto o sistema deixa e registra o
 * aparelho se ela aceitar. Devolve como ficou; 'denied' é quando só os ajustes do aparelho resolvem
 * (ver openPushSettings). Com a permissão já dada, só refaz o registro.
 */
export async function enablePush(): Promise<PushPermission | null> {
  if (!enabled()) return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    // No Android, depois da primeira recusa o sistema ainda mostra a pergunta mais uma vez.
    if (permission.receive !== 'granted' && permission.receive !== 'denied') permission = await PushNotifications.requestPermissions();
    if (permission.receive === 'granted') await register();
    return permissionOf(permission.receive);
  } catch (error) {
    avisos?.(`Notificações indisponíveis: ${errorMessage(error)}`);
    return null;
  }
}

// Plugin do próprio app Android (android/…/AppSettingsPlugin.java); não existe nas versões anteriores a ele.
const AppSettings = registerPlugin<{ openNotifications(): Promise<void> }>('AppSettings');

/**
 * Abre a tela do sistema onde se liberam as notificações do DSB. Devolve false quando este
 * aparelho não tem como abrir daqui (app Android anterior ao plugin): aí a tela explica o caminho.
 */
export async function openPushSettings() {
  try {
    if (Capacitor.getPlatform() === 'ios') {
      // Endereço dos ajustes do próprio app: o Capacitor entrega ao iOS tudo o que não é página do site.
      window.location.href = 'app-settings:';
      return true;
    }
    if (!Capacitor.isPluginAvailable('AppSettings')) return false;
    await AppSettings.openNotifications();
    return true;
  } catch { return false; }
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
