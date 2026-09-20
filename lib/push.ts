import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

/**
 * Registra o aparelho para notificações (só no app das lojas).
 * Precisa do Firebase configurado nos projetos nativos; até lá fica desligado
 * por NEXT_PUBLIC_PUSH_ENABLED, porque o Android fecha o app sem o google-services.json.
 */
export async function registerPush() {
  if (!Capacitor.isNativePlatform() || process.env.NEXT_PUBLIC_PUSH_ENABLED !== 'true') return;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return;
  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener('registration', ({ value }) => {
    void supabase.rpc('register_push_device', { p_token: value, p_platform: Capacitor.getPlatform() });
  });
  await PushNotifications.register();
}
