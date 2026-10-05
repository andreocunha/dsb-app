'use client';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { eventConfig } from './event-config';

/**
 * Link da live definido pela organização no painel (/admin), atualizado ao vivo:
 * trocar o link troca a transmissão de quem já está assistindo.
 * O banco manda: link vazio lá tira a live do ar. Enquanto carrega (ou sem conexão com o banco),
 * vale o do build (NEXT_PUBLIC_YOUTUBE_LIVE_URL).
 */
export function useLiveUrl() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.from('event_settings').select('live_url').maybeSingle()
      .then(({ data }) => { if (alive && data) setUrl(data.live_url); });
    const channel = supabase.channel('live-url')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_settings' }, ({ new: row }) => setUrl((row as { live_url: string }).live_url))
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, []);
  return url ?? eventConfig.youtubeUrl;
}
