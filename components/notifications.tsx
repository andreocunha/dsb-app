'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ChevronRight, Flag, Megaphone, Trophy } from 'lucide-react';
import { Modal } from './ui';
import { useWide } from './chat/use-wide';
import { supabase } from '@/lib/supabase';
import { useLocalState } from '@/lib/local-state';
import { useNow } from '@/lib/races';
import { onResume } from '@/lib/resume';
import { proxiedImage } from '@/lib/images';
import {
  KIND_LABEL, NOTIFICATIONS_LIMIT, NOTIFICATIONS_MOCK, fullDate, isUnread, onOpenNotification, timeAgo, unreadCount,
  type AppNotification, type NotificationKind,
} from '@/lib/notifications';

const SEEN_KEY = 'dsb-notifications-seen';
const ICON: Record<NotificationKind, typeof Bell> = { announcement: Megaphone, race_start: Flag, fantasy_reminder: Trophy };

/** Últimas notificações, com as novas chegando pelo tempo real (e de novo ao voltar para o app). */
function useNotifications() {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  useEffect(() => {
    // Condição escrita aqui (e não só NOTIFICATIONS_MOCK): assim o build de produção nem gera o arquivo do mock.
    if (process.env.NODE_ENV === 'development' && NOTIFICATIONS_MOCK) {
      let stop = () => {};
      let alive = true;
      void import('@/lib/notifications-mock').then(mock => { if (alive) stop = mock.subscribeMock(list => setItems([...list])); });
      return () => { alive = false; stop(); };
    }
    let alive = true;
    const load = () => void supabase.from('notifications').select('id, kind, title, body, image_url, created_at')
      .order('id', { ascending: false }).limit(NOTIFICATIONS_LIMIT)
      .then(({ data, error }) => { if (alive && !error) setItems(data); });
    load();
    const stopResume = onResume(load);
    const channel = supabase.channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, ({ new: row }) => {
        const n = row as AppNotification;
        setItems(current => current?.some(i => i.id === n.id) ? current : [n, ...(current ?? [])].slice(0, NOTIFICATIONS_LIMIT));
      })
      .subscribe();
    return () => { alive = false; stopResume(); void supabase.removeChannel(channel); };
  }, []);
  return items;
}

/**
 * Sino da home: o número é o que chegou desde a última vez que a lista foi aberta.
 * Abrir a lista marca tudo como visto; as novas continuam com o ponto até fechar.
 * No celular a lista ocupa a tela inteira e o recado abre num modal por cima dela;
 * no desktop os dois ficam no mesmo modal centralizado (o recado como página dentro dele).
 *
 * Devolve o botão e o modal separados: o botão vai no card do topo e o modal fica fora dele,
 * para não herdar os estilos do card (.hud-actions button, .race-card p).
 */
export function useNotificationCenter() {
  const items = useNotifications();
  const now = useNow();
  const wide = useWide();
  const [seen, setSeen] = useLocalState(SEEN_KEY, 0);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<number | null>(null);
  // O visto de antes de abrir: é ele que decide o ponto de "nova" enquanto a lista está na tela.
  const [seenBefore, setSeenBefore] = useState(0);
  const count = items && now ? unreadCount(items, seen, now) : 0;
  const latest = items?.[0]?.id ?? 0;

  function show(id: number | null) {
    setSeenBefore(seen);
    setPage(id);
    setOpen(true);
  }
  // Com a lista aberta, o que chega já entra como visto.
  useEffect(() => { if (open && latest > seen) setSeen(latest); }, [open, latest, seen, setSeen]);

  // Toque numa notificação do sistema (lib/push.ts): abre direto o recado.
  const showRef = useRef(show);
  useEffect(() => { showRef.current = show; });
  useEffect(() => onOpenNotification(id => showRef.current(id)), []);

  const current = page === null ? null : items?.find(n => n.id === page) ?? null;
  // O último recado aberto continua no modal enquanto ele sai (a animação de fechar).
  const [last, setLast] = useState<AppNotification | null>(null);
  if (current && current !== last) setLast(current);
  const label = count ? `Notificações, ${count} ${count === 1 ? 'nova' : 'novas'}` : 'Notificações';

  const bell = <button className="hud-bell" aria-haspopup="dialog" aria-label={label} onClick={() => show(null)}>
    <Bell size={16} />
    {count > 0 && <span className="bell-badge" aria-hidden="true">{count > 9 ? '9+' : count}</span>}
  </button>;
  // Fechar só esconde: o recado continua na tela enquanto o modal sai (o sino abre de novo já na lista, ver show).
  const close = () => setOpen(false);
  const list = <NotificationList items={items} now={now} fresh={n => !!now && isUnread(n, seenBefore, now)} onOpen={setPage} />;
  const modal = wide
    ? <Modal open={open} onClose={close} title={current ? 'Notificação' : 'Notificações'}
        page={current ? `n:${current.id}` : 'list'} depth={current ? 1 : 0} onBack={current ? () => setPage(null) : undefined}>
        {current ? <NotificationDetail n={current} onClose={close} /> : list}
      </Modal>
    : <>
        <Modal fill open={open} onClose={close} title="Notificações">{list}</Modal>
        {/* Por cima da lista: fechar volta para ela. "Acompanhar no mapa" e "Abrir o fantasy" fecham tudo. */}
        <Modal open={open && !!current} onClose={() => setPage(null)} title="Notificação">
          {last && <NotificationDetail n={last} onClose={close} />}
        </Modal>
      </>;
  return { bell, modal };
}

/** A lista do sino: ícone pelo tipo, título, começo do texto, há quanto tempo e a miniatura da imagem. */
function NotificationList({ items, now, fresh, onOpen }: {
  items: AppNotification[] | null; now: number; fresh: (n: AppNotification) => boolean; onOpen: (id: number) => void;
}) {
  if (!items) return <p className="panel-note">Carregando…</p>;
  if (!items.length) return <div className="notif-empty">
    <span><BellOff size={22} /></span>
    <h3>Nada por aqui ainda</h3>
    <p>Recados da organização e avisos das largadas aparecem aqui.</p>
  </div>;
  return <ul className="notif-list">
    {items.map(n => {
      const Icon = ICON[n.kind];
      const isFresh = fresh(n);
      return <li key={n.id}>
        <button className={`notif-item ${isFresh ? 'fresh' : ''}`} onClick={() => onOpen(n.id)}>
          <span className="notif-icon"><Icon size={17} /></span>
          <span className="notif-text">
            <strong>{n.title}</strong>
            {n.body && <span className="notif-body">{n.body}</span>}
            {/* Rodapé: de onde veio e quando, igual em todos os itens. */}
            <small className="notif-when">{KIND_LABEL[n.kind]}{now ? ` · ${timeAgo(n.created_at, now)}` : ''}</small>
          </span>
          {n.image_url && <img className="notif-thumb" src={proxiedImage(n.image_url, 112)} alt="" loading="lazy" decoding="async" />}
          {isFresh && <span className="notif-dot" aria-label="Nova" />}
        </button>
      </li>;
    })}
  </ul>;
}

/** O recado aberto: imagem ou GIF em destaque (no tamanho original, para o GIF seguir animado), título e texto. */
function NotificationDetail({ n, onClose }: { n: AppNotification; onClose: () => void }) {
  const Icon = ICON[n.kind];
  const [loaded, setLoaded] = useState(false);
  return <article className="notif-detail">
    {n.image_url && <figure className={`notif-media ${loaded ? 'loaded' : ''}`}>
      <img src={n.image_url} alt="" decoding="async" onLoad={() => setLoaded(true)} />
    </figure>}
    <p className="notif-meta"><Icon size={14} /> {KIND_LABEL[n.kind]} · {fullDate(n.created_at)}</p>
    <h3>{n.title}</h3>
    {n.body && <p className="notif-detail-body">{n.body}</p>}
    {n.kind === 'race_start' && <button className="sheet-row" onClick={onClose}><Flag size={20} /><span>Acompanhar no mapa</span><ChevronRight size={18} /></button>}
    {n.kind === 'fantasy_reminder' && <Link replace href="/fantasy/" className="sheet-row" onClick={onClose}><Trophy size={20} /><span>Abrir o fantasy</span><ChevronRight size={18} /></Link>}
  </article>;
}
