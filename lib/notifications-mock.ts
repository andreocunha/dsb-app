// Notificações de mentira para testar o sino no `npm run dev` sem tocar no banco de produção.
// Liga com NEXT_PUBLIC_NOTIFICATIONS_MOCK=true no .env.development.local; no build das lojas e do site
// (NODE_ENV=production) o mock nem entra no pacote.
//
// No console do navegador:
//   dsbMockNotification()                         → chega um recado novo (o sino acende na hora)
//   dsbMockNotification({ image_url: '/mock/largada.gif' })
// O "Enviar agora" do painel da organização também cai aqui, em vez de mandar para todo mundo.
// Só é carregado por import() atrás de NOTIFICATIONS_MOCK (lib/notifications.ts).
import type { AppNotification } from './notifications';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

let items: AppNotification[] = [
  {
    id: 6, kind: 'announcement', title: 'Largada liberada na raia! 🏁', created_at: minutesAgo(4),
    body: 'Vento estável e mar calmo. A Prova 2 larga às 14h em ponto: acompanhe os barcos ao vivo no mapa e na live.',
    image_url: '/mock/largada.gif',
  },
  {
    id: 5, kind: 'race_start', title: 'Prova 2 — Raia Longa começou!', body: 'Acompanhe os barcos ao vivo no mapa.',
    image_url: null, created_at: minutesAgo(38),
  },
  {
    id: 4, kind: 'fantasy_reminder', title: 'Prova 2 começa em 1 hora', body: 'Raia Longa. Última chance de mudar seu fantasy.',
    image_url: null, created_at: minutesAgo(95),
  },
  {
    id: 3, kind: 'announcement', title: 'Programação de amanhã', created_at: minutesAgo(26 * 60),
    body: 'Abertura oficial às 14h no píer, com a apresentação das equipes. Traga protetor solar e chegue cedo!',
    image_url: '/images/event-race.jpg',
  },
  {
    id: 2, kind: 'announcement', title: 'Prova 3 adiada para 15h', body: 'Vento forte na raia. Assim que liberar, avisamos por aqui.',
    image_url: null, created_at: minutesAgo(3 * 24 * 60),
  },
  // Como os recados antigos (antes do sino) chegam: só com o título.
  { id: 1, kind: 'announcement', title: 'Bem-vindos ao Desafio Solar Brasil!', body: null, image_url: null, created_at: minutesAgo(9 * 24 * 60) },
];

const listeners = new Set<(items: AppNotification[]) => void>();
const emit = () => listeners.forEach(listener => listener(items));

export function subscribeMock(listener: (items: AppNotification[]) => void) {
  listeners.add(listener);
  listener(items);
  return () => { listeners.delete(listener); };
}

/** Um recado novo chegando, como pelo tempo real. */
export function addMockNotification(over: Partial<AppNotification> = {}) {
  const id = Math.max(0, ...items.map(n => n.id)) + 1;
  items = [{
    id, kind: 'announcement', title: `Recado de teste #${id}`, body: 'Chegou agora, pelo mock. Toque para abrir.',
    image_url: null, created_at: new Date().toISOString(), ...over,
  }, ...items];
  emit();
  return id;
}

if (typeof window !== 'undefined') {
  (window as unknown as { dsbMockNotification: typeof addMockNotification }).dsbMockNotification = addMockNotification;
}
