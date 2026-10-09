'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Sheet } from './ui';
import { useClock } from '@/lib/use-schedule';
import {
  LATE_AFTER, clock, dayIndex, dayLabel, durationText, featured, hhmm, phases, shiftLabel, shiftOf, startsIn,
  type Phase, type ScheduleItem, type Shift,
} from '@/lib/schedule';

type Entry = { item: ScheduleItem; phase: Phase };

/** Horário com o anterior riscado ao lado, quando mudou. Remarcada para outro dia risca a data. */
function When({ item, shift, now }: { item: ScheduleItem; shift: Shift | null; now: number }) {
  return <>
    {dayLabel(item.startsAt, now)} · {shift && <s>{shift.kind === 'moved' ? dayLabel(shift.originalAt) : hhmm(shift.originalAt)}</s>} {hhmm(item.startsAt)}
  </>;
}

/** Etiqueta de situação: atrasada, remarcada, acontecendo agora. */
export function Tag({ tone, children }: { tone: 'live' | 'warn' | 'muted'; children: React.ReactNode }) {
  return <span className={`tag tag-${tone}`}>{tone === 'live' && <span className="live-dot" />}{children}</span>;
}

/**
 * Topo da home: o que está acontecendo (com o relógio regressivo) ou o próximo item da programação.
 * Tocar abre a programação inteira.
 */
export function ScheduleCard({ items, actions }: { items: ScheduleItem[] | null; actions: React.ReactNode }) {
  // Segundo a segundo só com algo valendo (relógio regressivo no card e na programação).
  const coarse = useClock(false);
  const counting = !!items && coarse > 0 && phases(items, coarse).some(({ phase }) => phase.kind === 'live' || phase.kind === 'closing');
  const now = useClock(counting);
  const [open, setOpen] = useState(false);
  // Mesma lista enquanto dados e relógio não mudam: abrir e fechar o sheet não redesenha as linhas.
  const list = useMemo(() => (items && now ? phases(items, now) : []), [items, now]);
  const current = featured(list);

  let body: React.ReactNode = <><span className="eyebrow">Desafio Solar Brasil</span><h1>Carregando programação…</h1><p>&nbsp;</p></>;
  let progress: number | null = null;
  if (current) {
    const { item, phase } = current;
    const shift = shiftOf(item);
    const label = item.label ? ` · ${item.label}` : '';
    let eyebrow: React.ReactNode, meta: React.ReactNode;
    switch (phase.kind) {
      case 'live':
        eyebrow = <><span className="live-dot" /> Agora{label}</>;
        meta = phase.endsAt
          ? <>Termina em <strong className="countdown">{clock(phase.endsAt - now)}</strong></>
          : <>Começou às {hhmm(phase.startedAt)}</>;
        if (phase.endsAt) progress = (now - phase.startedAt) / (phase.endsAt - phase.startedAt);
        break;
      case 'closing':
        eyebrow = <><span className="live-dot" /> Última volta{label}</>;
        meta = <>Tempo esgotado · fecha às {hhmm(phase.limitAt)} <strong className="countdown">{clock(phase.limitAt - now)}</strong></>;
        progress = 1;
        break;
      case 'late':
        eyebrow = <>A seguir{label}</>;
        meta = phase.since < LATE_AFTER
          ? <>Previsto {hhmm(item.startsAt)} · <Tag tone="warn">Largada em instantes</Tag></>
          : <>Previsto {hhmm(item.startsAt)} · <Tag tone="warn">Atrasada</Tag></>;
        break;
      case 'upcoming': {
        const soon = item.startsAt - now < 24 * 3_600_000;
        eyebrow = <>A seguir{label}</>;
        meta = <><When item={item} shift={shift} now={now} />{soon && <> · {startsIn(item.startsAt - now)}</>}{shift && <> <Tag tone={shift.kind === 'delayed' ? 'warn' : 'muted'}>{shiftLabel[shift.kind]}</Tag></>}</>;
        break;
      }
      default:
        eyebrow = <>Encerrado{label}</>;
        meta = <When item={item} shift={null} now={now} />;
    }
    body = <>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{item.title}<ChevronRight size={18} aria-hidden="true" /></h1>
      <p>{meta}</p>
    </>;
  }

  return <section className="hud-card race-card" aria-label="Programação">
    <button className="race-card-main" aria-haspopup="dialog" onClick={() => setOpen(true)} disabled={!current}>{body}</button>
    {actions}
    {progress !== null && <span className="race-progress" style={{ '--p': Math.min(Math.max(progress, 0), 1) } as React.CSSProperties} aria-hidden="true" />}
    <ScheduleSheet open={open} onClose={() => setOpen(false)} list={list} now={now} currentKey={current?.item.key ?? null} />
  </section>;
}

/** Programação inteira por dia, com o que está acontecendo em destaque. */
function ScheduleSheet({ open, onClose, list, now, currentKey }: {
  open: boolean; onClose: () => void; list: Entry[]; now: number; currentKey: string | null;
}) {
  const body = useRef<HTMLOListElement>(null);
  // Abre já no que está acontecendo ou no próximo.
  useEffect(() => {
    if (open) body.current?.querySelector('.schedule-row.is-current')?.scrollIntoView({ block: 'center' });
  }, [open]);

  return <Sheet open={open} onClose={onClose} title="Programação" subtitle="Horário de Brasília">
    <ol className="schedule" ref={body}><Days list={list} now={now} currentKey={currentKey} /></ol>
  </Sheet>;
}

/** As linhas, separadas do sheet: o toque de abrir ou fechar não redesenha a lista (pesa em celular simples). */
const Days = memo(function Days({ list, now, currentKey }: { list: Entry[]; now: number; currentKey: string | null }) {
  const days: { day: number; entries: Entry[] }[] = [];
  for (const entry of list) {
    const day = dayIndex(entry.item.startsAt);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(entry);
  }
  return days.map(({ day, entries }) => <li key={day}>
    <h3 className="schedule-day">{dayLabel(entries[0].item.startsAt, now) === 'Hoje' ? `Hoje · ${dayLabel(entries[0].item.startsAt)}` : dayLabel(entries[0].item.startsAt, now)}</h3>
    <ol>{entries.map(entry => <Row key={entry.item.key} {...entry} now={now} current={entry.item.key === currentKey} />)}</ol>
  </li>);
});

function Row({ item, phase, now, current }: Entry & { now: number; current: boolean }) {
  const shift = shiftOf(item);
  const details = [item.label, item.durationMinutes && item.kind === 'race' ? `${durationText(item.durationMinutes)} de prova` : ''].filter(Boolean).join(' · ');
  const original = shift ? (shift.kind === 'moved' ? `${dayLabel(shift.originalAt)}, ${hhmm(shift.originalAt)}` : hhmm(shift.originalAt)) : '';

  let status: React.ReactNode = null;
  switch (phase.kind) {
    case 'live': status = <><Tag tone="live">Agora</Tag>{phase.endsAt && <small className="countdown">{clock(phase.endsAt - now)}</small>}</>; break;
    case 'closing': status = <><Tag tone="live">Última volta</Tag><small className="countdown">{clock(phase.limitAt - now)}</small></>; break;
    case 'late': status = <Tag tone="warn">{phase.since < LATE_AFTER ? 'Em instantes' : 'Atrasada'}</Tag>; break;
    case 'upcoming': status = <>
      {shift && <Tag tone={shift.kind === 'delayed' ? 'warn' : 'muted'}>{shiftLabel[shift.kind]}</Tag>}
      {current && <small>{startsIn(item.startsAt - now)}</small>}
    </>; break;
    default: status = <small>{item.kind === 'race' ? 'Encerrada' : 'Encerrado'}</small>;
  }

  return <li className={`schedule-row is-${phase.kind} ${current ? 'is-current' : ''}`}>
    <span className="schedule-time">
      <strong>{hhmm(item.startsAt)}</strong>
      {shift && shift.kind !== 'moved' && <s>{hhmm(shift.originalAt)}</s>}
    </span>
    <span className="schedule-main">
      <strong>{item.title}</strong>
      {details && <small>{details}</small>}
      {shift && <small className="schedule-shift">Antes {original}{shift.reason && ` · ${shift.reason}`}</small>}
    </span>
    <span className="schedule-status">{status}</span>
  </li>;
}
