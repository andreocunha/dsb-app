import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import { deviceFromUserAgent, type Device } from './device';

// Id aleatório desta instalação (ou deste navegador). Fica no aparelho: reinstalar gera outro.
const KEY = 'dsb-install';
// O que já foi enviado nesta abertura, para não repetir o mesmo registro.
let sent: string | null = null;

function installId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
    return id;
  } catch { return null; }
}

type Hints = { model?: string; platform?: string; platformVersion?: string };
type HintedNavigator = Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Hints> } };

async function device(): Promise<Device> {
  const found = deviceFromUserAgent(navigator.userAgent);
  if (found.model || !found.os?.startsWith('Android')) return found;
  // O Chrome esconde modelo e versão no user agent, mas entrega os dois quando o site pede.
  try {
    const hints = await (navigator as HintedNavigator).userAgentData?.getHighEntropyValues(['model', 'platformVersion']);
    const major = hints?.platformVersion?.split('.')[0];
    return { model: hints?.model || null, os: major ? `Android ${major}` : found.os };
  } catch { return found; }
}

/** granted: liberadas; ask: o sistema ainda mostra a pergunta; denied: recusadas. Null fora do app das lojas. */
async function pushStatus() {
  if (!Capacitor.isNativePlatform() || process.env.NEXT_PUBLIC_PUSH_ENABLED !== 'true') return null;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.checkPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'ask';
  } catch { return null; }
}

/** Versão do app das lojas ("1.0 (1)"); null no navegador. */
async function appVersion() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { App } = await import('@capacitor/app');
    const { version, build } = await App.getInfo();
    return `${version} (${build})`;
  } catch { return null; }
}

/**
 * Registra esta instalação para os números da organização (/admin › Números): plataforma, aparelho,
 * versão do app, se as notificações estão liberadas e se alguém entrou na conta por aqui.
 * Como o app das lojas carrega o site, vale também para quem já tinha o app instalado.
 * É só métrica: qualquer falha passa em silêncio.
 */
export async function trackInstall(userId: string | null) {
  if (process.env.NODE_ENV !== 'production' || /bot|crawl|spider|headless|lighthouse/i.test(navigator.userAgent)) return;
  const id = installId();
  if (!id) return;
  try {
    const [{ model, os }, push, version] = await Promise.all([device(), pushStatus(), appVersion()]);
    const state = JSON.stringify([userId, model, os, version, push]);
    if (state === sent) return;
    sent = state;
    const { error } = await supabase.rpc('track_install', { p_id: id, p_platform: Capacitor.getPlatform(), p_model: model, p_os: os, p_app_version: version, p_push: push });
    if (error) sent = null;
  } catch { sent = null; }
}
