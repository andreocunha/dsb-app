// Histórico de notificações (sino da home): recados da organização e avisos das provas.
// As linhas vêm da tabela notifications; o que já foi visto é o último id visto: fica no aparelho e,
// com conta, também no banco (notification_reads), igual em todos os aparelhos dela.

export type NotificationKind = 'announcement' | 'race_start' | 'fantasy_reminder';
export type AppNotification = {
  id: number; kind: NotificationKind; title: string; body: string | null; image_url: string | null; created_at: string;
};

/** Sino com dados de mentira no `npm run dev` (lib/notifications-mock.ts); no build é sempre false e o mock fica fora do pacote. */
export const NOTIFICATIONS_MOCK = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_NOTIFICATIONS_MOCK === 'true';

/** Quantas aparecem no sino: o histórico é curto, como na bandeja do celular. */
export const NOTIFICATIONS_LIMIT = 50;
/** Mais antiga que isso não acende o sino: quem abre o app pela primeira vez não vê o histórico todo como novo. */
export const UNREAD_WINDOW = 7 * 24 * 60 * 60_000;

export const KIND_LABEL: Record<NotificationKind, string> = {
  announcement: 'Organização', race_start: 'Largada', fantasy_reminder: 'Fantasy',
};

/** Não vistas: depois do último id visto e dos últimos dias. */
export function unreadCount(items: AppNotification[], seen: number, now: number) {
  return items.filter(n => isUnread(n, seen, now)).length;
}
export const isUnread = (n: AppNotification, seen: number, now: number) =>
  n.id > seen && now - Date.parse(n.created_at) < UNREAD_WINDOW;

/**
 * Um recado ou aviso de prova que está na bandeja do sistema já foi visto no sino?
 * O iOS devolve o id que foi junto com o aviso. O Android só devolve título e texto, então vale o texto:
 * sai da bandeja quando todos os avisos do histórico com aquele título e texto já foram vistos.
 */
export function seenInTray(
  n: { title?: string | null; body?: string | null; data?: Record<string, unknown> | null }, items: AppNotification[], seen: number,
) {
  const id = Number(n.data?.n);
  if (Number.isInteger(id) && id > 0) return id <= seen;
  const same = items.filter(i => i.title === n.title && (i.body ?? '') === (n.body ?? ''));
  return same.length > 0 && same.every(i => i.id <= seen);
}

const TZ = 'America/Sao_Paulo';
const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ms);

/** "agora", "há 5 min", "há 3 h", "ontem", "12 out". */
export function timeAgo(iso: string, now: number) {
  const at = Date.parse(iso);
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60 && day(at) === day(now)) return `há ${Math.floor(minutes / 60)} h`;
  if (day(at) === day(now - 24 * 60 * 60_000)) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(at).replace('.', '').replace(' de ', ' ');
}

/** Data e hora completas, para o recado aberto: "12 out, 14:05". */
export function fullDate(iso: string) {
  const at = Date.parse(iso);
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' }).format(at).replace('.', '').replace(' de ', ' ');
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(at);
  return `${date}, ${time}`;
}

// Toque numa notificação do sistema: o app abre a home e o sino abre o recado.
// Se o toque é que abriu o app, a home ainda não montou: o id espera até ela começar a ouvir.
let pending: number | null = null;
const listeners = new Set<(id: number) => void>();

export function openNotification(id: number) {
  if (!listeners.size) { pending = id; return; }
  listeners.forEach(listener => listener(id));
}

export function onOpenNotification(listener: (id: number) => void) {
  listeners.add(listener);
  if (pending !== null) { const id = pending; pending = null; listener(id); }
  return () => { listeners.delete(listener); };
}
