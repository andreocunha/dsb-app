'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { shortName } from '@/lib/names';
import { supabase } from '@/lib/supabase';
import { Avatar } from '../ui';
import { Tail } from './message';
import type { Person } from './types';

/** Quem está digitando (ou gravando áudio) agora numa conversa. */
export type Typer = { id: string; name: string; audio: boolean };
/** Por conversa ("geral" ou o id dela), quem está digitando. */
export type Typing = Record<string, Typer[]>;

// Quem digita avisa a cada 3 s; 5 s sem aviso e a pessoa parou.
const TYPING_TTL = 5000;
/** Quantas conversas da lista mostram "digitando…": cada uma é um canal a mais na conexão. */
export const MAX_WATCHED = 10;
// Fotos no balão do grupo: até 3 sobrepostas e, com mais gente, "+N".
const MAX_FACES = 3;
export const NO_TYPERS: Typer[] = [];

/**
 * "Digitando…" das conversas em `keys` (a aberta e as mais recentes da lista). Cada conversa tem um canal de avisos,
 * que serve para ouvir e, na conversa aberta, para avisar (send). stop: a mensagem chegou, a pessoa parou de digitar.
 */
export function useTyping(keys: string[], userId: string | null, name: string | null) {
  const [typing, setTyping] = useState<Typing>({});
  const channels = useRef(new Map<string, RealtimeChannel>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const watched = [...new Set(keys)].sort().join(',');

  const stop = useCallback((key: string, id: string) => {
    clearTimeout(timers.current.get(`${key}|${id}`));
    timers.current.delete(`${key}|${id}`);
    setTyping(current => current[key]?.some(t => t.id === id) ? { ...current, [key]: current[key].filter(t => t.id !== id) } : current);
  }, []);

  // Só entra e sai dos canais das conversas que mudaram: a lista reordena a cada mensagem.
  useEffect(() => {
    const want = new Set(watched ? watched.split(',') : []);
    const open = channels.current;
    for (const [key, channel] of open) if (!want.has(key)) { void supabase.removeChannel(channel); open.delete(key); }
    for (const key of want) if (!open.has(key)) open.set(key, supabase.channel(`typing:${key}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { id, name: who, audio } = payload as { id?: unknown; name?: unknown; audio?: unknown };
        if (typeof id !== 'string' || typeof who !== 'string') return;
        const typer: Typer = { id, name: who.slice(0, 40), audio: audio === true };
        setTyping(current => {
          const list = current[key] ?? NO_TYPERS;
          const same = list.find(t => t.id === id);
          if (same && same.name === typer.name && same.audio === typer.audio) return current;
          return { ...current, [key]: same ? list.map(t => t.id === id ? typer : t) : [...list, typer] };
        });
        clearTimeout(timers.current.get(`${key}|${id}`));
        timers.current.set(`${key}|${id}`, setTimeout(() => stop(key, id), TYPING_TTL));
      })
      .subscribe());
  }, [watched, stop]);

  useEffect(() => {
    const open = channels.current, pending = timers.current;
    return () => { open.forEach(channel => void supabase.removeChannel(channel)); open.clear(); pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  /** Avisa quem está na conversa (aberta ou vendo a lista) que você está digitando, ou gravando áudio. */
  const send = useCallback((key: string, audio: boolean) => {
    if (userId && name) void channels.current.get(key)?.send({ type: 'broadcast', event: 'typing', payload: { id: userId, name: shortName(name), audio } });
  }, [userId, name]);

  return { typing, send, stop };
}

/**
 * O texto verde da lista de conversas, como no WhatsApp: na particular só "digitando…"; no grupo, quem é
 * ou, com mais de uma pessoa, quantas são. Gravando áudio mostra sempre um nome só.
 */
export function typingText(typers: Typer[], group: boolean) {
  const recording = typers.every(t => t.audio);
  if (!group) return recording ? 'gravando áudio…' : 'digitando…';
  if (typers.length === 1 || recording) return `${typers[0].name} está ${recording ? 'gravando áudio' : 'digitando'}…`;
  return `${typers.length} pessoas digitando…`;
}

/**
 * Balão de "digitando" no fim da conversa, como no WhatsApp: três pontinhos subindo e descendo (com o microfone,
 * para quem grava áudio). Nos grupos vai junto a foto de quem está digitando.
 */
export function TypingBubble({ typers, people, group }: { typers: Typer[]; people: Person[]; group: boolean }) {
  const recording = typers.every(t => t.audio);
  return <div className="msg in first typing-row" role="status" aria-label={typingText(typers, group)}>
    {group && <span className="typing-faces">
      {typers.slice(0, MAX_FACES).map(t => <Avatar key={t.id} id={t.id} name={t.name} url={people.find(p => p.id === t.id)?.avatar_url} small />)}
      {typers.length > MAX_FACES && <span className="avatar small typing-more">+{typers.length - MAX_FACES}</span>}
    </span>}
    <div className="msg-main">
      <div className="bubble typing-bubble">
        <Tail />
        {recording && <Mic size={13} />}
        <span className="typing-dots" aria-hidden><i /><i /><i /></span>
      </div>
    </div>
  </div>;
}
