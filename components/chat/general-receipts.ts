'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Receipts } from './message';

type State = { receipts: Receipts | null; version: number };
const NONE: State = { receipts: null, version: 0 };
let channels = 0;

/**
 * Tiques das suas mensagens no grupo geral: até onde todo mundo recebeu (✓✓) e leu (✓✓ azul).
 * Quem calcula é o banco (o menor entre todos); aqui só busca de novo quando alguém recebe ou lê.
 * version: muda a cada atualização, para os dados da mensagem acompanharem.
 */
export function useGeneralReceipts(enabled: boolean): State {
  const [state, setState] = useState<State>(NONE);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => void supabase.rpc('general_receipts').then(({ data }) => {
      const row = data?.[0];
      if (alive && row) setState(current => ({ receipts: { read: row.read, delivered: row.delivered }, version: current.version + 1 }));
    });
    load();
    // Várias leituras chegam juntas quando sai uma mensagem nova: uma busca só.
    const channel = supabase.channel(`general-reads:${++channels}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'general_reads' }, () => { clearTimeout(timer); timer = setTimeout(load, 800); })
      .subscribe();
    return () => { alive = false; clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [enabled]);
  return enabled ? state : NONE;
}
