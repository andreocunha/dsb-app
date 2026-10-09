'use client';
import { useState } from 'react';
import { Check, ChevronRight, Flag, RotateCcw, Square } from 'lucide-react';
import { useApp } from './app-shell';
import { Sheet } from './ui';
import { supabase, errorMessage } from '@/lib/supabase';
import { useClock, useSchedule } from '@/lib/use-schedule';
import { dayIndex, dayLabel, durationText, hhmm, phases, shiftLabel, shiftOf, type Phase, type ScheduleItem } from '@/lib/schedule';

const MINUTE = 60_000;
const dateKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });
/** Data e hora digitadas no horário de Brasília (sem horário de verão desde 2019). */
const fromInputs = (date: string, time: string) => Date.parse(`${date}T${time}:00-03:00`);
const toInputs = (ms: number) => ({ date: dateKey.format(ms), time: hhmm(ms) });

function phaseText(item: ScheduleItem, phase: Phase) {
  switch (phase.kind) {
    case 'live': return phase.endsAt ? `Acontecendo · termina ${hhmm(phase.endsAt)}` : `Acontecendo desde ${hhmm(phase.startedAt)}`;
    case 'closing': return `Última volta até ${hhmm(phase.limitAt)}`;
    case 'late': return 'Passou do horário · marque a largada';
    case 'done': return item.kind === 'race' ? 'Encerrada' : 'Encerrado';
    default: { const shift = shiftOf(item); return shift ? `${shiftLabel[shift.kind]} · antes ${hhmm(shift.originalAt)}` : 'No horário'; }
  }
}

/** Aba Agenda do painel: atrasar ou remarcar qualquer item, largar e encerrar as provas. */
export function SchedulePanel() {
  const { items, reload } = useSchedule('programacao-admin');
  const now = useClock();
  const [selected, setSelected] = useState<{ key: string; open: boolean } | null>(null);
  if (!items || !now) return <p className="panel-note">Carregando…</p>;
  const list = phases(items, now);
  const current = list.find(entry => entry.item.key === selected?.key) ?? null;

  const days: { day: number; entries: typeof list }[] = [];
  for (const entry of list) {
    const day = dayIndex(entry.item.startsAt);
    if (days.at(-1)?.day !== day) days.push({ day, entries: [] });
    days.at(-1)!.entries.push(entry);
  }

  return <>
    {days.map(({ day, entries }) => <section key={day} className="settings-group">
      <h2 className="settings-label">{dayLabel(entries[0].item.startsAt, now)}</h2>
      <ul className="settings-card admin-list">
        {entries.map(({ item, phase }) => <li key={item.key} className="admin-row">
          <button className="admin-row-info" onClick={() => setSelected({ key: item.key, open: true })} aria-haspopup="dialog">
            <span className="admin-agenda-time">{hhmm(item.startsAt)}</span>
            <span className="admin-row-main">
              <strong>{item.label ? `${item.label} · ${item.title}` : item.title}</strong>
              <small className={`admin-agenda-${phase.kind}`}>{phaseText(item, phase)}</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
    </section>)}
    <p className="settings-hint">Mudar um horário aparece na hora para todo mundo, com o horário anterior riscado, e fica no histórico. Nas provas, também muda o fechamento do fantasy e o lembrete de 1 hora antes.</p>
    <Sheet open={!!selected?.open} onClose={() => setSelected(s => s && { ...s, open: false })}
      title={current?.item.title ?? 'Programação'} subtitle={current ? [current.item.label, `${dayLabel(current.item.startsAt)}, ${hhmm(current.item.startsAt)}`].filter(Boolean).join(' · ') : undefined}>
      {current && <>
        {current.item.kind === 'race' && <RaceControls item={current.item} phase={current.phase} onChanged={reload} />}
        <Reschedule key={`${current.item.key}:${current.item.startsAt}`} item={current.item} onChanged={reload} />
        {current.item.changes.length > 0 && <section className="admin-sheet-section">
          <h3>Histórico de horários</h3>
          <ul className="lap-list">
            {[...current.item.changes].reverse().map(change => <li key={change.changed_at}>
              <span className="lap-time"><s>{hhmm(Date.parse(change.previous_at))}</s> → {dayIndex(Date.parse(change.previous_at)) !== dayIndex(Date.parse(change.new_at)) ? `${dayLabel(Date.parse(change.new_at))}, ` : ''}{hhmm(Date.parse(change.new_at))}{change.reason && ` · ${change.reason}`}</span>
              <small className="admin-when">{dayLabel(Date.parse(change.changed_at))}, {hhmm(Date.parse(change.changed_at))}</small>
            </li>)}
          </ul>
        </section>}
      </>}
    </Sheet>
  </>;
}

/** Largou agora / desfazer e encerrar / reabrir. */
function RaceControls({ item, phase, onChanged }: { item: ScheduleItem; phase: Phase; onChanged: () => void }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  async function run(rpc: 'admin_set_race_start' | 'admin_set_race_finish', at: string | null, message: string) {
    setBusy(true);
    const { error } = await supabase.rpc(rpc, { p_race_id: item.id, p_at: at });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    notify(message);
    onChanged();
  }
  const now = () => new Date().toISOString();
  const autoEnd = item.startedAt && item.durationMinutes
    ? item.startedAt + (item.durationMinutes + (item.closingMinutes ?? 0)) * MINUTE : null;

  return <section className="admin-sheet-section">
    <h3>Largada e fim</h3>
    {item.startedAt === null
      ? <>
        <p className="settings-hint">{phase.kind === 'late' ? 'Passou do horário: até marcar a largada, o app mostra a prova como atrasada.' : 'Marque quando a prova largar: o relógio regressivo começa a contar dali.'}</p>
        <button className="button primary" disabled={busy} onClick={() => void run('admin_set_race_start', now(), `${item.title} largou.`)}><Flag size={16} /> Largou agora</button>
      </>
      : <>
        <p className="settings-hint">
          Largou às {hhmm(item.startedAt)}.{' '}
          {item.finishedAt ? `Encerrada às ${hhmm(item.finishedAt)}.`
            : autoEnd ? `${durationText(item.durationMinutes!)} de prova${item.closingMinutes ? ` + ${item.closingMinutes} min para a última volta` : ''}: encerra sozinha às ${hhmm(autoEnd)}.`
            : 'Sem duração fixa: encerre quando terminar.'}
        </p>
        <div className="account-actions">
          <button className="button ghost" disabled={busy} onClick={() => void run('admin_set_race_start', null, 'Largada desfeita.')}><RotateCcw size={16} /> Desfazer largada</button>
          {item.finishedAt
            ? <button className="button" disabled={busy} onClick={() => void run('admin_set_race_finish', null, `${item.title} reaberta.`)}><RotateCcw size={16} /> Reabrir</button>
            : <button className="button" disabled={busy} onClick={() => void run('admin_set_race_finish', now(), `${item.title} encerrada.`)}><Square size={14} /> Encerrar agora</button>}
        </div>
      </>}
  </section>;
}

/** Novo horário: atalhos para atraso no mesmo dia, ou data e hora para remarcar. */
function Reschedule({ item, onChanged }: { item: ScheduleItem; onChanged: () => void }) {
  const { notify } = useApp();
  const initial = toInputs(item.startsAt);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [reason, setReason] = useState('');
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const target = date && time ? fromInputs(date, time) : NaN;
  const changed = Number.isFinite(target) && target !== item.startsAt;
  const started = item.kind === 'race' && item.startedAt !== null;

  const shiftBy = (minutes: number) => { const next = toInputs(item.startsAt + minutes * MINUTE); setDate(next.date); setTime(next.time); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed || started) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_reschedule', { p_kind: item.kind, p_id: item.id, p_at: new Date(target).toISOString(), p_reason: reason.trim() });
    if (error) { setBusy(false); notify(errorMessage(error)); return; }
    if (announce) {
      // Mesmo texto para atraso e remarcação: o horário novo, o antigo e o motivo.
      const sameDay = dayIndex(target) === dayIndex(item.startsAt);
      const title = `${item.label ? `${item.label} · ` : ''}${item.title}: novo horário`.slice(0, 65);
      const before = sameDay ? hhmm(item.startsAt) : `${dayLabel(item.startsAt).toLowerCase()}, ${hhmm(item.startsAt)}`;
      const body = `${dayLabel(target)}, às ${hhmm(target)} (antes ${before}).${reason.trim() ? ` Motivo: ${reason.trim()}.` : ''}`.slice(0, 240);
      const sent = await supabase.rpc('send_announcement', { p_title: title, p_body: body });
      if (sent.error) notify(`Horário salvo, mas a notificação falhou: ${errorMessage(sent.error)}`);
    }
    setBusy(false);
    setReason('');
    notify(announce ? 'Horário salvo e notificação enviada.' : 'Horário salvo.');
    onChanged();
  }

  return <form className="admin-sheet-section" onSubmit={e => void save(e)}>
    <h3>Mudar horário</h3>
    {started
      ? <p className="settings-hint">A prova já largou. Para mudar o horário, desfaça a largada antes.</p>
      : <>
        <div className="admin-shift-chips" role="group" aria-label="Atrasar a partir do horário atual">
          {[10, 15, 30, 60].map(m => <button key={m} type="button" className="button" onClick={() => shiftBy(m)}>+{m < 60 ? `${m} min` : '1 h'}</button>)}
        </div>
        <div className="admin-when-fields">
          <label className="admin-field"><span>Dia</span><input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="admin-field"><span>Hora (Brasília)</span><input type="time" required value={time} onChange={e => setTime(e.target.value)} /></label>
        </div>
        <label className="admin-field">
          <span>Motivo (opcional) <small>{reason.length}/120</small></span>
          <input maxLength={120} placeholder="Ex.: vento forte na raia" value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <label className="settings-split admin-extra toggle-row">
          <div><strong>Avisar todo mundo</strong><small>Notificação com o novo horário</small></div>
          <button type="button" role="switch" className="toggle" aria-checked={announce} aria-label="Avisar todo mundo por notificação" onClick={() => setAnnounce(!announce)}><span /></button>
        </label>
        <button className="button primary" type="submit" disabled={!changed || busy}><Check size={16} /> {busy ? 'Salvando…' : changed ? `Mudar para ${dayIndex(target) === dayIndex(item.startsAt) ? '' : `${dayLabel(target)}, `}${hhmm(target)}` : 'Escolha o novo horário'}</button>
      </>}
  </form>;
}
