import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { Database } from './database.types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Chave publicável (sb_publishable_...): pode ir no app, o acesso é controlado por RLS e RPC.
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const nativo = typeof window !== 'undefined' && Capacitor.isNativePlatform();
export const supabase = createClient<Database>(url, key, {
  // No app das lojas a sessão chega pelo deep link, então detectSessionInUrl fica desligado.
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: !nativo },
});

/** URL pública de um arquivo do chat (bucket público, servido pela CDN). */
export const chatFileUrl = (path: string) => `${url}/storage/v1/object/public/chat/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Mensagem de erro amigável vinda de uma RPC (as funções já lançam textos em português). */
export const errorMessage = (error: unknown) =>
  (error as { message?: string })?.message || 'Algo deu errado. Tente novamente.';
