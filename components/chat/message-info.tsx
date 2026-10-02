'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCheck, X } from 'lucide-react';
import type { Database } from '@/lib/database.types';
import { whenLabel } from '@/lib/chat-format';
import { registerOverlay } from '@/lib/overlays';
import { supabase } from '@/lib/supabase';
import { Avatar } from '../ui';
import { Bubble, type Receipts } from './message';
import type { Message, Reply } from './types';

type Receipt = Database['public']['Functions']['message_info']['Returns'][number];

/** "Hoje às 18:34". Leituras de antes do histórico de horários não têm hora. */
function when(at: string | null) {
  if (!at) return 'Horário não registrado';
  const label = whenLabel(at);
  return label[0].toUpperCase() + label.slice(1);
}

/**
 * Dados da mensagem, como no WhatsApp: o balão em cima e, embaixo, quem recebeu e quem leu, com o horário.
 * Só para as suas mensagens nas particulares e nos grupos. Tela cheia no celular, painel à direita no desktop.
 * stamp: muda quando alguém da conversa recebe ou lê, para a lista acompanhar em tempo real.
 */
export function MessageInfo({ message, userId, reply, group, receipts, stamp, onClose }: {
  message: Message; userId: string | null; reply: Reply | null; group: boolean; receipts: Receipts | null; stamp: string; onClose: () => void;
}) {
  const [list, setList] = useState<{ id: number; rows: Receipt[] | null } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.group-close')?.focus({ focusVisible: false } as FocusOptions);
    const solta = registerOverlay(() => fechar.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    window.addEventListener('keydown', onKey);
    return () => { solta(); window.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('message_info', { p_message_id: message.id }).then(({ data, error }) => { if (alive) setList({ id: message.id, rows: error ? null : data ?? [] }); });
    return () => { alive = false; };
  }, [message.id, stamp]);

  const loaded = list?.id === message.id ? list : null;
  const rows = loaded?.rows ?? null;
  const read = rows?.filter(r => r.read) ?? [];
  const delivered = rows?.filter(r => r.delivered && !r.read) ?? [];
  const waiting = rows ? rows.length - read.length - delivered.length : 0;

  return <aside ref={ref} className="group-info message-info" aria-label="Dados da mensagem">
    <header className="group-info-header">
      <button className="icon-button group-close" onClick={onClose} aria-label="Fechar">
        <ArrowLeft size={22} className="only-mobile" /><X size={22} className="only-desktop" />
      </button>
      <h2>Dados da mensagem</h2>
    </header>

    <div className="group-info-body">
      <div className="message-info-preview">
        <div className="chat-wallpaper" aria-hidden />
        <div className="msg own first"><Bubble message={message} first userId={userId} reply={reply} group={group} receipts={receipts} /></div>
      </div>

      {!loaded ? <p className="panel-note">Carregando…</p>
        : !rows ? <p className="panel-note">Não foi possível carregar os dados da mensagem.</p>
        : !group ? rows.slice(0, 1).map(r => <div key={r.user_id} className="receipt-pair">
          <ReceiptLabel kind="read" />
          <time>{r.read ? when(r.read_at) : '—'}</time>
          <ReceiptLabel kind="delivered" />
          <time>{r.delivered ? when(r.delivered_at) : '—'}</time>
        </div>)
        : <>
          <ReceiptLabel kind="read" group />
          <ReceiptList rows={read} at={r => r.read_at} />
          {read.length < rows.length && <p className="receipt-remaining">{rows.length - read.length} {rows.length - read.length === 1 ? 'restante' : 'restantes'}</p>}
          <hr />
          <ReceiptLabel kind="delivered" group />
          <ReceiptList rows={delivered} at={r => r.delivered_at} />
          {waiting > 0 && <p className="receipt-remaining">{waiting} {waiting === 1 ? 'restante' : 'restantes'}</p>}
        </>}
    </div>
  </aside>;
}

/** Particular: "Lida" e "Entregue". Grupo: "Lida por" e "Entregue para", com a lista embaixo. */
function ReceiptLabel({ kind, group = false }: { kind: 'read' | 'delivered'; group?: boolean }) {
  return <p className="receipt-label">
    {kind === 'read' ? <><CheckCheck size={18} className="tick-read" />{group ? 'Lida por' : 'Lida'}</>
      : <><CheckCheck size={18} />{group ? 'Entregue para' : 'Entregue'}</>}
  </p>;
}

function ReceiptList({ rows, at }: { rows: Receipt[]; at: (r: Receipt) => string | null }) {
  if (!rows.length) return null;
  return <ul className="receipt-list">
    {rows.map(r => <li key={r.user_id} className="group-member">
      <Avatar id={r.user_id} name={r.name} url={r.avatar_url} letter />
      <span><strong>{r.name}</strong><small>{when(at(r))}</small></span>
    </li>)}
  </ul>;
}
