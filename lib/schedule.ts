// Programação do evento: provas e os outros itens (abertura, seminários, premiação), em que
// fase cada um está e como mostrar atraso e mudança de horário. Sem React nem Supabase, para testar.

export type ScheduleChange = { previous_at: string; new_at: string; reason: string; changed_at: string };

export type ScheduleItem = {
  key: string;
  kind: 'race' | 'event';
  id: string;
  title: string;
  /** "Prova 1", ou vazio nos itens que não são prova. */
  label: string;
  startsAt: number;
  /** Largada real marcada pela organização (só provas). */
  startedAt: number | null;
  finishedAt: number | null;
  durationMinutes: number | null;
  closingMinutes: number | null;
  /** Mudanças de horário, da mais antiga para a mais nova. */
  changes: ScheduleChange[];
};

export type Phase =
  | { kind: 'upcoming' }
  /** Passou do horário e a organização ainda não marcou a largada. */
  | { kind: 'late'; since: number }
  /** endsAt: fim do tempo de prova, para o relógio regressivo (null quando não há duração). */
  | { kind: 'live'; startedAt: number; endsAt: number | null }
  /** Tempo de prova esgotado: os barcos fecham a última volta até limitAt. */
  | { kind: 'closing'; limitAt: number }
  | { kind: 'done' };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Brasília está em UTC−3 o ano todo desde 2019. */
const BRT = -3 * 60 * MINUTE;
/** Itens sem duração (abertura, seminários) contam como "agora" por esta janela. */
const EVENT_MINUTES = 60;
/** Logo depois do horário ainda é "largada em instantes"; depois disso, atrasada. */
export const LATE_AFTER = 5 * MINUTE;

export const dayIndex = (time: number) => Math.floor((time + BRT) / DAY);
const endOfDay = (time: number) => (dayIndex(time) + 1) * DAY - BRT;

type RaceRow = {
  id: string; number: number; name: string; starts_at: string; started_at: string | null; finished_at: string | null;
  duration_minutes: number | null; closing_minutes: number | null;
};
const time = (iso: string | null) => (iso ? Date.parse(iso) : null);
/** Prova como item da programação (as fases valem igual no card, na programação e nos resultados). */
export const itemFromRace = (race: RaceRow, changes: ScheduleChange[] = []): ScheduleItem => ({
  key: `race:${race.id}`, kind: 'race', id: race.id, title: race.name, label: `Prova ${race.number}`,
  startsAt: Date.parse(race.starts_at), startedAt: time(race.started_at), finishedAt: time(race.finished_at),
  durationMinutes: race.duration_minutes, closingMinutes: race.closing_minutes, changes,
});

/** Fase de um item sozinho. `later`: algum item seguinte já começou (encerra o que ficou esquecido). */
export function phaseOf(item: ScheduleItem, now: number, later = false): Phase {
  if (item.finishedAt !== null && now >= item.finishedAt) return { kind: 'done' };
  if (item.kind === 'event') {
    if (now < item.startsAt) return { kind: 'upcoming' };
    const end = item.startsAt + (item.durationMinutes ?? EVENT_MINUTES) * MINUTE;
    if (now < end && !later) return { kind: 'live', startedAt: item.startsAt, endsAt: item.durationMinutes ? end : null };
    return { kind: 'done' };
  }
  if (item.startedAt === null) {
    if (now < item.startsAt) return { kind: 'upcoming' };
    // Prova que ninguém marcou como largada: não fica "atrasada" para sempre.
    if (later || now >= endOfDay(item.startsAt)) return { kind: 'done' };
    return { kind: 'late', since: now - item.startsAt };
  }
  if (item.durationMinutes) {
    const end = item.startedAt + item.durationMinutes * MINUTE;
    if (now < end) return { kind: 'live', startedAt: item.startedAt, endsAt: end };
    const limit = end + (item.closingMinutes ?? 0) * MINUTE;
    if (now < limit) return { kind: 'closing', limitAt: limit };
    return { kind: 'done' };
  }
  // Sem duração (Match Race, Slalom, Sprint): vale até a organização encerrar ou o dia acabar.
  if (now >= endOfDay(item.startedAt)) return { kind: 'done' };
  return { kind: 'live', startedAt: item.startedAt, endsAt: null };
}

export const sortSchedule = (items: ScheduleItem[]) =>
  [...items].sort((a, b) => a.startsAt - b.startsAt || (a.kind === b.kind ? a.label.localeCompare(b.label, 'pt-BR', { numeric: true }) : a.kind === 'event' ? -1 : 1));

/** Fase de cada item da programação, já ordenada. */
export function phases(items: ScheduleItem[], now: number) {
  const sorted = sortSchedule(items);
  return sorted.map((item, i) => {
    const later = sorted.slice(i + 1).some(next => next.startsAt > item.startsAt && (next.startedAt !== null || (next.kind === 'event' && next.startsAt <= now)));
    return { item, phase: phaseOf(item, now, later) };
  });
}

/** O que vai no card da home: o que está acontecendo, senão o próximo, senão o último. */
export function featured(list: { item: ScheduleItem; phase: Phase }[]) {
  const active = list.find(({ phase }) => phase.kind === 'live' || phase.kind === 'closing' || phase.kind === 'late');
  // Prova acontecendo vence item fora da raia (ex.: seminário no meio da tarde).
  const race = list.find(({ item, phase }) => item.kind === 'race' && (phase.kind === 'live' || phase.kind === 'closing'));
  return race ?? active ?? list.find(({ phase }) => phase.kind === 'upcoming') ?? list[list.length - 1] ?? null;
}

/** Como o horário mudou em relação ao original, para a etiqueta ao lado do horário. */
export type Shift = { kind: 'delayed' | 'earlier' | 'moved'; originalAt: number; reason: string };
export function shiftOf(item: ScheduleItem): Shift | null {
  if (!item.changes.length) return null;
  const originalAt = Date.parse(item.changes[0].previous_at);
  if (originalAt === item.startsAt) return null;
  const reason = [...item.changes].reverse().find(change => change.reason)?.reason ?? '';
  const kind = dayIndex(originalAt) !== dayIndex(item.startsAt) ? 'moved' : item.startsAt > originalAt ? 'delayed' : 'earlier';
  return { kind, originalAt, reason };
}
export const shiftLabel: Record<Shift['kind'], string> = { delayed: 'Atrasada', earlier: 'Antecipada', moved: 'Remarcada' };

const pad = (n: number) => String(n).padStart(2, '0');
/** Relógio regressivo: 1:42:07 ou 42:07. */
export function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
/** Quanto falta, por extenso curto: "em 5 min", "em 2h 10min", "em 3 dias". */
export function startsIn(ms: number) {
  const minutes = Math.ceil(ms / MINUTE);
  if (minutes <= 1) return 'em instantes';
  if (minutes < 60) return `em ${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 24) return `em ${hours}h${rest ? ` ${rest}min` : ''}`;
  const days = Math.round(ms / DAY);
  return `em ${days} ${days === 1 ? 'dia' : 'dias'}`;
}
/** Duração da prova: "1h", "2h30", "45 min". */
export function durationText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? pad(minutes % 60) : ''}`;
}

const dayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Sao_Paulo' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
/** 15:00, no horário de Brasília. */
export const hhmm = (time: number) => timeFormat.format(time);
/** "Ter, 13 out", ou "Hoje" e "Amanhã" quando `now` é conhecido. */
export function dayLabel(time: number, now = 0) {
  if (now) {
    const diff = dayIndex(time) - dayIndex(now);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
  }
  const text = dayFormat.format(time).replace(/\./g, '');
  return text[0].toUpperCase() + text.slice(1);
}
