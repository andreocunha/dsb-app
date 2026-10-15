'use client';
import { useState } from 'react';
import { Check, Flag, RotateCcw, Square } from 'lucide-react';
import { useApp } from './app-shell';
import { DurationForm } from './admin-duration';
import { supabase, errorMessage } from '@/lib/supabase';
import { dayIndex, dayLabel, durationText, hhmm, type Phase, type ScheduleItem } from '@/lib/schedule';

const MINUTE = 60_000;
const dateKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });
/** Data e hora digitadas no horário de Brasília (sem horário de verão desde 2019). */
const fromInputs = (date: string, time: string) => Date.parse(`${date}T${time}:00-03:00`);
const toInputs = (ms: number) => ({ date: dateKey.format(ms), time: hhmm(ms) });

type Section = 'time' | 'duration' | 'start';
const SECTIONS: { id: Section; label: string }[] = [{ id: 'time', label: 'Horário' }, { id: 'duration', label: 'Duração' }, { id: 'start', label: 'Largada' }];

/**
 * O que a organização muda num item da programação (aberto pela própria programação, tocando no
 * item): horário de qualquer item e, nas provas, duração e largada, uma coisa de cada vez.
 */
export function ScheduleItemEditor({ item, phase, onChanged }: { item: ScheduleItem; phase: Phase; onChanged: () => void }) {
  const race = item.kind === 'race';
  // Abre no que faz sentido agora: prova andando muda a duração; atrasada, marca a largada.
  const [section, setSection] = useState<Section>(!race ? 'time' : item.startedAt !== null ? 'duration' : phase.kind === 'late' ? 'start' : 'time');
  const show = race ? section : 'time';

  return <>
    {race && <div className="segmented admin-item-tabs" role="radiogroup" aria-label="O que mudar">
      {SECTIONS.map(s => <button key={s.id} role="radio" aria-checked={show === s.id} onClick={() => setSection(s.id)}>{s.label}</button>)}
    </div>}
    {show === 'time' && <>
      <Reschedule key={`${item.key}:${item.startsAt}`} item={item} onChanged={onChanged} />
      {item.changes.length > 0 && <section className="admin-sheet-section">
        <h3>Histórico de horários</h3>
        <ul className="lap-list">
          {[...item.changes].reverse().map(change => <li key={change.changed_at}>
            <span className="lap-time"><s>{hhmm(Date.parse(change.previous_at))}</s> → {dayIndex(Date.parse(change.previous_at)) !== dayIndex(Date.parse(change.new_at)) ? `${dayLabel(Date.parse(change.new_at))}, ` : ''}{hhmm(Date.parse(change.new_at))}{change.reason && ` · ${change.reason}`}</span>
            <small className="admin-when">{dayLabel(Date.parse(change.changed_at))}, {hhmm(Date.parse(change.changed_at))}</small>
          </li>)}
        </ul>
      </section>}
      <p className="settings-hint">Mudar um horário aparece na hora para todo mundo, com o horário anterior riscado, e fica no histórico. Nas provas, também muda o fechamento do fantasy e o lembrete de 1 hora antes.</p>
    </>}
    {show === 'duration' && <DurationForm key={`${item.key}:${item.durationMinutes}:${item.closingMinutes}`} race={item} onChanged={onChanged} />}
    {show === 'start' && <RaceControls item={item} phase={phase} onChanged={onChanged} />}
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
