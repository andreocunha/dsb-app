'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useApp } from './app-shell';
import { supabase, errorMessage } from '@/lib/supabase';
import { durationText, hhmm } from '@/lib/schedule';
import { closingWindowMinutes } from '@/lib/scoring';

const MINUTE = 60_000;
const MAX_MINUTES = 24 * 60;
const MAX_CLOSING = 240;

/** O que o formulário precisa da prova (vale para a linha de races e para o item da programação). */
export type RaceTime = { id: string; durationMinutes: number | null; closingMinutes: number | null; startedAt: number | null };

/**
 * Tempo de prova e prazo da última volta. O relógio regressivo de quem está com o app aberto
 * passa a seguir o que for salvo aqui, mesmo com a prova já em andamento.
 */
export function DurationForm({ race, onChanged }: { race: RaceTime; onChanged: () => void | Promise<void> }) {
  const { notify } = useApp();
  const initial = {
    minutes: race.durationMinutes ? String(race.durationMinutes) : '',
    closing: String(race.closingMinutes ?? (race.durationMinutes ? Math.round(closingWindowMinutes(race.durationMinutes)) : 0)),
  };
  const [minutes, setMinutes] = useState(initial.minutes);
  const [closing, setClosing] = useState(initial.closing);
  const [busy, setBusy] = useState(false);

  const m = minutes.trim() === '' ? null : Number(minutes);
  const c = closing.trim() === '' ? 0 : Number(closing);
  const valid = (m === null || (Number.isInteger(m) && m >= 1 && m <= MAX_MINUTES)) && Number.isInteger(c) && c >= 0 && c <= MAX_CLOSING;
  const changed = minutes.trim() !== initial.minutes || (m !== null && String(c) !== initial.closing);
  const shift = (by: number) => setMinutes(String(Math.min(Math.max((m && Number.isFinite(m) ? m : 0) + by, 1), MAX_MINUTES)));

  const end = valid && m && race.startedAt ? race.startedAt + m * MINUTE : null;
  const hint = !valid ? 'Informe o tempo em minutos inteiros.'
    : m === null ? 'Sem tempo fixo: a prova vale até a organização encerrar, sem relógio regressivo.'
    : end ? `Largou às ${hhmm(race.startedAt!)}. Com ${durationText(m)} de prova, o relógio zera às ${hhmm(end)}${c ? ` e a última volta fecha às ${hhmm(end + c * MINUTE)}` : ''}.`
    : `${durationText(m)} de prova${c ? ` e mais ${c} min para fechar a última volta` : ''}. O relógio começa a contar na largada.`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !changed) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_race_duration', { p_race_id: race.id, p_minutes: m, p_closing_minutes: m === null ? null : c });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    notify(m === null ? 'Prova sem tempo fixo.' : `Tempo de prova: ${durationText(m)}.`);
    await onChanged();
  }

  return <form className="admin-sheet-section" onSubmit={e => void save(e)}>
    <h3>Tempo de prova</h3>
    <div className="admin-shift-chips" role="group" aria-label="Ajustar o tempo de prova">
      {[-10, -5, 5, 10].map(by => <button key={by} type="button" className="button" onClick={() => shift(by)}>{by > 0 ? '+' : '−'}{Math.abs(by)} min</button>)}
    </div>
    <div className="admin-when-fields">
      <label className="admin-field">
        <span>Tempo de prova (min)</span>
        <input type="number" min={1} max={MAX_MINUTES} inputMode="numeric" placeholder="Sem tempo fixo" value={minutes} onChange={e => setMinutes(e.target.value)} />
      </label>
      <label className="admin-field">
        <span>Última volta (min)</span>
        <input type="number" min={0} max={MAX_CLOSING} inputMode="numeric" disabled={m === null} value={m === null ? '' : closing} onChange={e => setClosing(e.target.value)} />
      </label>
    </div>
    <p className="settings-hint">{hint}</p>
    <button className="button primary" type="submit" disabled={!valid || !changed || busy}><Check size={16} /> {busy ? 'Salvando…' : 'Salvar tempo'}</button>
  </form>;
}
