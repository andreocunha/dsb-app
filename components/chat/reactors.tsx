'use client';
import { useEffect, useState } from 'react';
import { shortName } from '@/lib/names';
import { supabase } from '@/lib/supabase';
import { Avatar, Sheet } from '../ui';
import type { Message } from './types';

type Reactor = { user_id: string; name: string; avatar_url: string | null; emoji: string };

/** Quem reagiu, com as abas do WhatsApp: "Todas" e uma por emoji. */
export function Reactors({ message, userId, onClose, onRemove }: { message: Message | null; userId: string | null; onClose: () => void; onRemove: (message: Message) => void }) {
  const [reactors, setReactors] = useState<{ id: number; list: Reactor[] } | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const messageId = message?.id;
  const reactionCount = message?.reactions.length;
  useEffect(() => {
    if (!messageId) return;
    void supabase.rpc('message_reactors', { p_message_id: messageId }).then(({ data }) => setReactors({ id: messageId, list: (data as Reactor[] | null) ?? [] }));
  }, [messageId, reactionCount]);
  const list = reactors && reactors.id === messageId ? reactors.list : null;
  const counts = [...(list ?? []).reduce((map, r) => map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1), new Map<string, number>())];
  const active = tab && counts.some(([emoji]) => emoji === tab) ? tab : null;
  const shown = (list ?? []).filter(r => !active || r.emoji === active);
  const close = () => { setTab(null); onClose(); };

  return <Sheet open={!!message} onClose={close} title={list ? `${list.length} ${list.length === 1 ? 'reação' : 'reações'}` : 'Reações'}>
    {!list ? <p className="panel-note">Carregando…</p> : <>
      <div className="reactor-tabs" role="tablist">
        <button role="tab" aria-selected={!active} onClick={() => setTab(null)}>Todas {list.length}</button>
        {counts.map(([emoji, count]) => <button key={emoji} role="tab" aria-selected={active === emoji} onClick={() => setTab(emoji)}>{emoji} {count}</button>)}
      </div>
      <ul className="reactors">
        {shown.map(r => {
          const mine = r.user_id === userId;
          const content = <>
            <Avatar id={r.user_id} name={r.name} url={r.avatar_url} />
            <span>{mine ? 'Você' : shortName(r.name)}{mine && <small>Toque para remover</small>}</span>
            <b>{r.emoji}</b>
          </>;
          return <li key={r.user_id}>{mine ? <button onClick={() => { setTab(null); onRemove(message!); }}>{content}</button> : <div>{content}</div>}</li>;
        })}
      </ul>
    </>}
  </Sheet>;
}
