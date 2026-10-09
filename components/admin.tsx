'use client';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Flag, LogIn, Megaphone, Minus, Plus, Radio, RotateCcw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from './app-shell';
import { SchedulePanel } from './admin-schedule';
import { useAuth } from './auth';
import { Sheet, TeamBadge } from './ui';
import { supabase, errorMessage } from '@/lib/supabase';
import type { Race, Team } from '@/lib/data';
import { useRaceLaps, useResults, type ResultsData } from '@/lib/results';
import { hasStarted, useNow } from '@/lib/races';
import { youtubeEmbedUrl } from '@/lib/event-config';
import {
  DOC_ITEMS, duelStageLabel, duelWinner, formatDuel, formatDuration, lapSplits, parseDuel, sortRace,
  type Duel, type DuelStage, type Score, type Status,
} from '@/lib/scoring';

type Tab = 'races' | 'agenda' | 'teams' | 'notify' | 'live';
const TABS: { id: Tab; label: string }[] = [
  { id: 'races', label: 'Provas' }, { id: 'agenda', label: 'Agenda' }, { id: 'teams', label: 'Equipes' }, { id: 'notify', label: 'Notificação' }, { id: 'live', label: 'Live' },
];
const STAGES: DuelStage[] = ['r32', 'r16', 'qf', 'sf', 'third', 'final'];
const STATUS: { id: Status; label: string }[] = [{ id: 'ok', label: 'Normal' }, { id: 'dnf', label: 'DNF' }, { id: 'dns', label: 'DNS' }];

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Sao_Paulo' });
/** Horário digitado (hora de Brasília) no dia da prova. Brasília não tem horário de verão desde 2019. */
const atRaceDay = (race: Race, time: string) =>
  new Date(`${dayKey.format(new Date(race.starts_at))}T${time.length === 5 ? `${time}:00` : time}-03:00`).toISOString();
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR');

/** Provas lidas direto do banco (sem o cache das outras telas): a largada muda por aqui. */
function useAdminRaces() {
  const [races, setRaces] = useState<Race[] | null>(null);
  const load = () => supabase.from('races').select('*').order('number').then(({ data }) => { if (data) setRaces(data as Race[]); });
  useEffect(() => { void load(); }, []);
  return [races, async () => { await load(); }] as const;
}

export function Admin() {
  const { userId, isAdmin, requireLogin } = useAuth();
  const [tab, setTab] = useState<Tab>('races');
  const [races, reloadRaces] = useAdminRaces();
  const { data, error, reload } = useResults(isAdmin === true, 'resultados-admin');

  const heading = <div className="page-heading"><div><h1>Organização</h1><p>Voltas, horários, pontos, notificações e a transmissão ao vivo.</p></div></div>;
  if (!userId || isAdmin === false) return <div className="page settings admin">
    {heading}
    <div className="settings-card settings-signin">
      <span className="settings-signin-icon">{userId ? <ShieldCheck size={20} /> : <LogIn size={20} />}</span>
      <div>
        <h2>{userId ? 'Área da organização' : 'Entre para continuar'}</h2>
        <p>{userId ? 'Esta conta não tem acesso. Peça para a organização liberar o seu e-mail.' : 'O painel é liberado para os e-mails da organização.'}</p>
      </div>
      {!userId && <button className="button primary" onClick={() => requireLogin('Entre com o e-mail da organização para abrir o painel.')}><LogIn size={16} /> Entrar</button>}
    </div>
  </div>;

  return <div className="page settings admin">
    {heading}
    <div className="segmented admin-tabs" role="radiogroup" aria-label="Seções do painel">
      {TABS.map(t => <button key={t.id} role="radio" aria-checked={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
    </div>
    {isAdmin === null || !races || !data
      ? <p className="panel-note">{error ? 'Não foi possível carregar. Confira sua conexão.' : 'Carregando…'}</p>
      : tab === 'races' ? <RacesPanel races={races} data={data} onRaceChanged={reloadRaces} />
      : tab === 'agenda' ? <SchedulePanel />
      : tab === 'teams' ? <TeamsPanel races={races} data={data} onChanged={reload} />
      : tab === 'notify' ? <NotifyPanel />
      : <LivePanel />}
  </div>;
}

// ---------------------------------------------------------------------
// Provas
// ---------------------------------------------------------------------

function RacesPanel({ races, data, onRaceChanged }: { races: Race[]; data: ResultsData; onRaceChanged: () => Promise<void> }) {
  const now = useNow();
  // Abre na prova que está acontecendo (a última que largou) ou na primeira.
  const current = [...races].reverse().find(r => hasStarted(r, now)) ?? races[0];
  const [raceId, setRaceId] = useState<string | null>(null);
  const race = races.find(r => r.id === raceId) ?? current;
  if (!race) return <p className="panel-note">Nenhuma prova cadastrada.</p>;

  return <>
    <label className="view-select admin-race-select">
      <span className="sr-only">Prova</span>
      <select value={race.id} onChange={e => setRaceId(e.target.value)}>
        {races.map(r => <option key={r.id} value={r.id}>Prova {r.number} · {r.name}</option>)}
      </select>
      <ChevronDown size={16} aria-hidden="true" />
    </label>
    {race.kind === 'bracket'
      ? <BracketAdmin key={race.id} race={race} data={data} />
      : <LapAdmin key={race.id} race={race} data={data} onRaceChanged={onRaceChanged} />}
  </>;
}

function StartRow({ race, onRaceChanged }: { race: Race; onRaceChanged: () => Promise<void> }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  async function setStart(at: string | null) {
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_race_start', { p_race_id: race.id, p_at: at });
    if (error) notify(errorMessage(error)); else await onRaceChanged();
    setBusy(false);
  }
  return <div className="settings-row settings-split">
    <div>
      <h3>Largada {race.started_at ? clock.format(new Date(race.started_at)) : clock.format(new Date(race.starts_at))}</h3>
      <p>{race.started_at ? 'Horário real, marcado pela organização.' : 'Horário previsto. Marque a largada real para o tempo da 1ª volta sair certo.'}</p>
    </div>
    {race.started_at
      ? <button className="button ghost" disabled={busy} onClick={() => void setStart(null)}><RotateCcw size={16} /> Usar o previsto</button>
      : <button className="button" disabled={busy} onClick={() => void setStart(new Date().toISOString())}><Flag size={16} /> Largou agora</button>}
  </div>;
}

/** Linha de cada barco: posição atual, voltas e a situação (DNF/DNS). */
function RowInfo({ team, score, detail }: { team: Team; score?: Score; detail: string }) {
  const tone = score && score.status !== 'ok' ? score.status : score?.position && score.position <= 3 ? `p${score.position}` : '';
  return <>
    <span className={`position-badge ${tone}`}>{score?.status !== 'ok' && score ? score.status.toUpperCase() : score?.position ? `${score.position}º` : '–'}</span>
    <TeamBadge team={team} small />
    <span className="admin-row-main"><strong>{team.name}</strong><small>{detail}</small></span>
  </>;
}

function LapAdmin({ race, data, onRaceChanged }: { race: Race; data: ResultsData; onRaceChanged: () => Promise<void> }) {
  const { notify } = useApp();
  const now = useNow();
  const server = useRaceLaps(race.id);
  // O tempo real chega com um pequeno atraso: a volta lançada aparece na hora por aqui.
  const [overlay, setOverlay] = useState<Map<string, 'add' | 'remove'>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<{ team: string; open: boolean } | null>(null);

  const lapsOf = (teamId: string) => {
    const set = new Set(server?.get(teamId) ?? []);
    for (const [key, op] of overlay) {
      const [team, ms] = key.split('|');
      if (team === teamId) { if (op === 'add') set.add(Number(ms)); else set.delete(Number(ms)); }
    }
    return [...set].sort((a, b) => a - b);
  };
  const mark = (teamId: string, ms: number, op: 'add' | 'remove') => setOverlay(current => new Map(current).set(`${teamId}|${ms}`, op));
  const setTeamBusy = (teamId: string, on: boolean) => setBusy(current => { const next = new Set(current); if (on) next.add(teamId); else next.delete(teamId); return next; });

  async function addLap(team: Team, at: string | null = null) {
    setTeamBusy(team.id, true);
    const { data: done, error } = await supabase.rpc('admin_add_lap', { p_race_id: race.id, p_team_id: team.id, p_at: at });
    setTeamBusy(team.id, false);
    if (error || !done) { notify(errorMessage(error)); return; }
    const ms = Date.parse(done);
    const count = new Set([...lapsOf(team.id), ms]).size;
    mark(team.id, ms, 'add');
    notify(`Volta ${count} de ${team.name} às ${clock.format(ms)}.`, { label: 'Desfazer', run: () => void removeLap(team, ms, false) });
  }
  async function removeLap(team: Team, ms: number, undoable = true) {
    const { error } = await supabase.rpc('admin_remove_lap', { p_race_id: race.id, p_team_id: team.id, p_at: new Date(ms).toISOString() });
    if (error) { notify(errorMessage(error)); return; }
    mark(team.id, ms, 'remove');
    if (undoable) notify('Volta apagada.', { label: 'Desfazer', run: () => void addLap(team, new Date(ms).toISOString()) });
    else notify('Volta desfeita.');
  }

  const scores = new Map(data.scores.filter(s => s.race_id === race.id).map(s => [s.team_id, s]));
  const ranked = sortRace([...scores.values()]).map(s => s.team_id);
  const teams = [...data.teams].sort((a, b) => {
    const ia = ranked.indexOf(a.id), ib = ranked.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || byName(a, b);
  });
  const start = Date.parse(race.started_at ?? race.starts_at);
  const selected = teams.find(t => t.id === sheet?.team) ?? null;

  function detail(team: Team) {
    const laps = lapsOf(team.id);
    const score = scores.get(team.id);
    const text = laps.length ? `${laps.length} ${laps.length === 1 ? 'volta' : 'voltas'} · última ${clock.format(laps[laps.length - 1])}` : 'Nenhuma volta';
    const ago = laps.length && now ? Math.round((now - laps[laps.length - 1]) / 60_000) : null;
    return [text, ago !== null && ago >= 0 && ago < 120 ? `há ${ago} min` : '', score?.note].filter(Boolean).join(' · ');
  }

  return <>
    <section className="settings-group">
      <div className="settings-card"><StartRow race={race} onRaceChanged={onRaceChanged} /></div>
    </section>
    <section className="settings-group" aria-labelledby="admin-laps">
      <h2 id="admin-laps" className="settings-label">Voltas · toque em + quando o barco fechar a volta</h2>
      <ul className="settings-card admin-list">
        {teams.map(team => <li key={team.id} className="admin-row">
          <button className="admin-row-info" onClick={() => setSheet({ team: team.id, open: true })} aria-haspopup="dialog">
            <RowInfo team={team} score={scores.get(team.id)} detail={detail(team)} />
          </button>
          <button className="button lap-button" disabled={busy.has(team.id)} onClick={() => void addLap(team)} aria-label={`Lançar volta de ${team.name}`}>
            <Plus size={18} /> Volta
          </button>
        </li>)}
      </ul>
    </section>
    <Sheet open={!!sheet?.open} onClose={() => setSheet(s => s && { ...s, open: false })} title={selected?.name ?? 'Equipe'} subtitle={`Prova ${race.number} · ${race.name}`}>
      {selected && <>
        <LapList laps={lapsOf(selected.id)} start={start}
          onRemove={ms => void removeLap(selected, ms)} onAdd={time => void addLap(selected, atRaceDay(race, time))} />
        <StatusForm key={selected.id} race={race} team={selected} />
      </>}
    </Sheet>
  </>;
}

function LapList({ laps, start, onRemove, onAdd }: {
  laps: number[]; start: number; onRemove: (ms: number) => void; onAdd: (time: string) => void;
}) {
  const [time, setTime] = useState('');
  const splits = lapSplits(laps, start);
  return <section className="admin-sheet-section">
    <h3>Voltas</h3>
    {laps.length ? <ol className="lap-list">
      {laps.map((ms, i) => <li key={ms}>
        <span className="lap-number">{i + 1}</span>
        <span className="lap-time">{clock.format(ms)}</span>
        <span className="lap-split">{formatDuration(splits[i])}</span>
        <button className="icon-button danger" onClick={() => onRemove(ms)} aria-label={`Apagar volta ${i + 1}`}><Trash2 size={16} /></button>
      </li>)}
    </ol> : <p className="panel-note">Nenhuma volta lançada.</p>}
    <form className="admin-inline-form" onSubmit={e => { e.preventDefault(); if (time) { onAdd(time); setTime(''); } }}>
      <label className="admin-field">
        <span>Volta que ficou para trás (horário de Brasília)</span>
        <input type="time" step={1} required value={time} onChange={e => setTime(e.target.value)} />
      </label>
      <button className="button" type="submit" disabled={!time}><Plus size={16} /> Lançar</button>
    </form>
  </section>;
}

/** DNF, DNS, colocação à mão e observação (tabela race_status). */
function StatusForm({ race, team }: { race: Race; team: Team }) {
  const { notify } = useApp();
  const [draft, setDraft] = useState<{ status: Status; position: string; note: string } | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabase.from('race_status').select('status, position, note').eq('race_id', race.id).eq('team_id', team.id).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const loaded = { status: (data?.status ?? 'ok') as Status, position: data?.position ? String(data.position) : '', note: data?.note ?? '' };
        setDraft(loaded);
        setSaved(JSON.stringify(loaded));
      });
    return () => { alive = false; };
  }, [race.id, team.id]);
  if (!draft) return <p className="panel-note">Carregando situação…</p>;
  const changed = JSON.stringify(draft) !== saved;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const position = draft.status === 'ok' && draft.position ? Number(draft.position) : null;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_race_status', { p_race_id: race.id, p_team_id: team.id, p_status: draft.status, p_position: position, p_note: draft.note });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    setSaved(JSON.stringify(draft));
    notify(`Situação de ${team.name} salva.`);
  }

  return <form className="admin-sheet-section" onSubmit={e => void save(e)}>
    <h3>Situação na prova</h3>
    <div className="segmented admin-status" role="radiogroup" aria-label="Situação">
      {STATUS.map(s => <button key={s.id} type="button" role="radio" aria-checked={draft.status === s.id} onClick={() => setDraft({ ...draft, status: s.id })}>{s.label}</button>)}
    </div>
    <p className="settings-hint">{draft.status === 'dnf' ? 'Largou e não terminou (inclui reboque): 20 pontos.' : draft.status === 'dns' ? 'Não largou: 0 pontos.' : `Colocação pelas ${race.kind === 'bracket' ? 'fases da chave' : 'voltas'}, ou a definida abaixo.`}</p>
    {draft.status === 'ok' && <label className="admin-field">
      <span>Colocação à mão (opcional)</span>
      <input type="number" min={1} max={99} inputMode="numeric" placeholder="Calculada" value={draft.position} onChange={e => setDraft({ ...draft, position: e.target.value })} />
    </label>}
    <label className="admin-field">
      <span>Observação no resultado (opcional)</span>
      <input maxLength={200} placeholder="Ex.: reboque na volta 4" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} />
    </label>
    <button className="button primary" type="submit" disabled={!changed || busy}><Check size={16} /> {busy ? 'Salvando…' : 'Salvar situação'}</button>
  </form>;
}

function BracketAdmin({ race, data }: { race: Race; data: ResultsData }) {
  const [editing, setEditing] = useState<{ duel: Duel; isNew: boolean; open: boolean } | null>(null);
  const [sheet, setSheet] = useState<{ team: string; open: boolean } | null>(null);
  const duels = data.duels.filter(d => d.race_id === race.id);
  const teams = new Map(data.teams.map(t => [t.id, t]));
  const scores = new Map(data.scores.filter(s => s.race_id === race.id).map(s => [s.team_id, s]));
  const selected = data.teams.find(t => t.id === sheet?.team) ?? null;

  function newDuel() {
    const stage = [...STAGES].reverse().find(s => duels.some(d => d.stage === s)) ?? 'qf';
    const slot = Math.max(0, ...duels.filter(d => d.stage === stage).map(d => d.slot)) + 1;
    setEditing({ duel: { race_id: race.id, stage, slot, team_a: null, team_b: null, time_a: null, time_b: null }, isNew: true, open: true });
  }
  const side = (team: string | null, time: number | null, won: boolean) =>
    <span className={`duel-side ${won ? 'won' : ''}`}><span>{team ? teams.get(team)?.name ?? team : 'A definir'}</span><small>{time !== null ? formatDuel(time) : '–'}</small></span>;

  return <>
    {STAGES.filter(stage => duels.some(d => d.stage === stage)).map(stage => <section key={stage} className="settings-group">
      <h2 className="settings-label">{duelStageLabel[stage]}</h2>
      <ul className="settings-card admin-list">
        {duels.filter(d => d.stage === stage).sort((a, b) => a.slot - b.slot).map(duel => {
          const winner = duelWinner(duel);
          return <li key={duel.slot}>
            <button className="admin-duel" onClick={() => setEditing({ duel, isNew: false, open: true })} aria-haspopup="dialog">
              <span className="lap-number">{duel.slot}</span>
              <span className="admin-duel-sides">{side(duel.team_a, duel.time_a, winner === 'a')}{side(duel.team_b, duel.time_b, winner === 'b')}</span>
              <ChevronRight size={18} />
            </button>
          </li>;
        })}
      </ul>
    </section>)}
    {!duels.length && <p className="panel-note">Nenhum duelo cadastrado. Na fase seguinte, o duelo N recebe os vencedores dos duelos 2N−1 e 2N.</p>}
    <button className="button primary admin-new" onClick={newDuel}><Plus size={16} /> Novo duelo</button>

    <section className="settings-group" aria-labelledby="admin-bracket-status">
      <h2 id="admin-bracket-status" className="settings-label">Situação dos barcos</h2>
      <ul className="settings-card admin-list">
        {[...data.teams].sort(byName).map(team => <li key={team.id} className="admin-row">
          <button className="admin-row-info" onClick={() => setSheet({ team: team.id, open: true })} aria-haspopup="dialog">
            <RowInfo team={team} score={scores.get(team.id)} detail={scores.get(team.id)?.note || (scores.has(team.id) ? 'Na chave' : 'Fora da chave')} />
          </button>
        </li>)}
      </ul>
    </section>

    <Sheet open={!!editing?.open} onClose={() => setEditing(e => e && { ...e, open: false })} title={editing?.isNew ? 'Novo duelo' : `${editing ? duelStageLabel[editing.duel.stage] : ''} · Duelo ${editing?.duel.slot ?? ''}`}>
      {editing && <DuelForm key={`${editing.duel.stage}-${editing.duel.slot}-${editing.isNew}`} duel={editing.duel} isNew={editing.isNew} teams={data.teams}
        onDone={() => setEditing(e => e && { ...e, open: false })} />}
    </Sheet>
    <Sheet open={!!sheet?.open} onClose={() => setSheet(s => s && { ...s, open: false })} title={selected?.name ?? 'Equipe'} subtitle={`Prova ${race.number} · ${race.name}`}>
      {selected && <StatusForm key={selected.id} race={race} team={selected} />}
    </Sheet>
  </>;
}

function DuelForm({ duel, isNew, teams, onDone }: { duel: Duel; isNew: boolean; teams: Team[]; onDone: () => void }) {
  const { notify } = useApp();
  const [form, setForm] = useState({
    stage: duel.stage, slot: String(duel.slot), team_a: duel.team_a ?? '', team_b: duel.team_b ?? '',
    time_a: duel.time_a !== null ? formatDuel(duel.time_a) : '', time_b: duel.time_b !== null ? formatDuel(duel.time_b) : '',
  });
  const [busy, setBusy] = useState(false);
  const sorted = [...teams].sort(byName);

  const save = (next: Duel) => supabase.rpc('admin_save_duel', {
    p_race_id: next.race_id, p_stage: next.stage, p_slot: next.slot, p_team_a: next.team_a, p_team_b: next.team_b, p_time_a: next.time_a, p_time_b: next.time_b,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const time_a = form.time_a.trim() ? parseDuel(form.time_a) : null;
    const time_b = form.time_b.trim() ? parseDuel(form.time_b) : null;
    if ((form.time_a.trim() && time_a === null) || (form.time_b.trim() && time_b === null)) { notify('Tempo inválido. Use 3:02,4 ou 182,4 (segundos).'); return; }
    const slot = Number(form.slot);
    if (!Number.isInteger(slot) || slot < 1) { notify('Número do duelo inválido.'); return; }
    if (isNew && teams.length && !form.team_a && !form.team_b) { notify('Escolha pelo menos um barco.'); return; }
    setBusy(true);
    const { error } = await save({ race_id: duel.race_id, stage: form.stage, slot, team_a: form.team_a || null, team_b: form.team_b || null, time_a, time_b });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    notify('Duelo salvo.');
    onDone();
  }
  async function remove() {
    setBusy(true);
    const { error } = await supabase.rpc('admin_delete_duel', { p_race_id: duel.race_id, p_stage: duel.stage, p_slot: duel.slot });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    onDone();
    notify('Duelo apagado.', { label: 'Desfazer', run: () => void save(duel).then(({ error }) => notify(error ? errorMessage(error) : 'Duelo de volta.')) });
  }

  const sideFields = (key: 'a' | 'b', label: string) => <div className="admin-duel-fields">
    <label className="admin-field">
      <span>{label}</span>
      <select value={form[`team_${key}`]} onChange={e => setForm({ ...form, [`team_${key}`]: e.target.value })}>
        <option value="">{key === 'b' ? 'Sem adversário (passa direto)' : 'A definir'}</option>
        {sorted.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
    <label className="admin-field">
      <span>Tempo</span>
      <input inputMode="decimal" placeholder="3:02,4" value={form[`time_${key}`]} onChange={e => setForm({ ...form, [`time_${key}`]: e.target.value })} />
    </label>
  </div>;

  return <form className="admin-form" onSubmit={e => void submit(e)}>
    {isNew && <div className="admin-duel-fields">
      <label className="admin-field">
        <span>Fase</span>
        <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value as DuelStage })}>
          {STAGES.map(s => <option key={s} value={s}>{duelStageLabel[s]}</option>)}
        </select>
      </label>
      <label className="admin-field">
        <span>Duelo nº</span>
        <input type="number" min={1} max={32} inputMode="numeric" value={form.slot} onChange={e => setForm({ ...form, slot: e.target.value })} />
      </label>
    </div>}
    {sideFields('a', 'Barco A')}
    {sideFields('b', 'Barco B')}
    <p className="settings-hint">Vence o menor tempo. Sem tempo, o barco perde o duelo.</p>
    <div className="account-actions">
      {!isNew && <button className="button danger" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={16} /> Apagar</button>}
      <button className="button primary" type="submit" disabled={busy}><Check size={16} /> {busy ? 'Salvando…' : 'Salvar duelo'}</button>
    </div>
  </form>;
}

// ---------------------------------------------------------------------
// Equipes: documentação, artigo e penalidades
// ---------------------------------------------------------------------

function TeamsPanel({ races, data, onChanged }: { races: Race[]; data: ResultsData; onChanged: () => void }) {
  const [sheet, setSheet] = useState<{ team: string; open: boolean } | null>(null);
  const selected = data.teams.find(t => t.id === sheet?.team) ?? null;
  return <>
    <section className="settings-group">
      <h2 className="settings-label">Pontos fora das provas e penalidades</h2>
      <ul className="settings-card admin-list">
        {[...data.teams].sort(byName).map(team => <li key={team.id} className="admin-row">
          <button className="admin-row-info" onClick={() => setSheet({ team: team.id, open: true })} aria-haspopup="dialog">
            <TeamBadge team={team} small />
            <span className="admin-row-main">
              <strong>{team.name}</strong>
              <small>Documentação {team.docs_delivered}/{DOC_ITEMS} · {team.article_delivered ? 'artigo entregue' : 'sem artigo'}{team.penalty_points < 0 ? ` · ${team.penalty_points} em penalidades` : ''}</small>
            </span>
            <span className="admin-row-points">{team.points.toLocaleString('pt-BR')} pts</span>
          </button>
        </li>)}
      </ul>
    </section>
    <Sheet open={!!sheet?.open} onClose={() => setSheet(s => s && { ...s, open: false })} title={selected?.name ?? 'Equipe'} subtitle={selected ? `${selected.points.toLocaleString('pt-BR')} pontos na geral` : undefined}>
      {selected && <TeamExtras key={selected.id} team={selected} races={races} penalties={data.penalties.filter(p => p.team_id === selected.id)} onChanged={onChanged} />}
    </Sheet>
  </>;
}

function TeamExtras({ team, races, penalties, onChanged }: { team: Team; races: Race[]; penalties: ResultsData['penalties']; onChanged: () => void }) {
  const { notify } = useApp();
  const [extras, setExtras] = useState({ docs: team.docs_delivered, article: team.article_delivered });
  const [penalty, setPenalty] = useState({ points: '', reason: '', race: '' });
  const [busy, setBusy] = useState(false);

  async function saveExtras(next: typeof extras) {
    const previous = extras;
    setExtras(next);
    const { error } = await supabase.rpc('admin_set_team_extras', { p_team_id: team.id, p_docs: next.docs, p_article: next.article });
    if (error) { setExtras(previous); notify(errorMessage(error)); return; }
    onChanged();
  }
  async function addPenalty(e: React.FormEvent) {
    e.preventDefault();
    const points = Math.abs(Number(penalty.points));
    if (!Number.isInteger(points) || points < 1 || points > 1000) { notify('Informe os pontos da penalidade (ex.: 10).'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_add_penalty', { p_team_id: team.id, p_points: points, p_reason: penalty.reason, p_race_id: penalty.race || null });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    setPenalty({ points: '', reason: '', race: '' });
    notify(`Penalidade de −${points} para ${team.name}.`);
  }
  async function removePenalty(p: ResultsData['penalties'][number]) {
    const { error } = await supabase.rpc('admin_delete_penalty', { p_id: p.id });
    if (error) { notify(errorMessage(error)); return; }
    notify('Penalidade apagada.', { label: 'Desfazer', run: () => void supabase.rpc('admin_add_penalty', { p_team_id: p.team_id, p_points: Math.abs(p.points), p_reason: p.reason, p_race_id: p.race_id }) });
  }

  return <>
    <section className="admin-sheet-section">
      <h3>Pontos fora das provas</h3>
      <div className="settings-split admin-extra">
        <div><strong>Documentação no prazo</strong><small>20 pontos por item entregue</small></div>
        <div className="stepper">
          <button className="icon-button" disabled={extras.docs <= 0} onClick={() => void saveExtras({ ...extras, docs: extras.docs - 1 })} aria-label="Um item a menos"><Minus size={16} /></button>
          <span aria-live="polite">{extras.docs}/{DOC_ITEMS}</span>
          <button className="icon-button" disabled={extras.docs >= DOC_ITEMS} onClick={() => void saveExtras({ ...extras, docs: extras.docs + 1 })} aria-label="Um item a mais"><Plus size={16} /></button>
        </div>
      </div>
      <label className="settings-split admin-extra toggle-row">
        <div><strong>Artigo científico</strong><small>20 pontos</small></div>
        <button type="button" role="switch" className="toggle" aria-checked={extras.article} aria-label="Artigo científico entregue" onClick={() => void saveExtras({ ...extras, article: !extras.article })}><span /></button>
      </label>
    </section>

    <section className="admin-sheet-section">
      <h3>Penalidades</h3>
      {penalties.length ? <ul className="penalty-list">
        {penalties.map(p => <li key={p.id}>
          <strong>{p.points}</strong>
          <span>{p.reason}<small>{p.race_id ? `Prova ${races.find(r => r.id === p.race_id)?.number ?? ''}` : 'Geral'}</small></span>
          <button className="icon-button danger" onClick={() => void removePenalty(p)} aria-label={`Apagar penalidade: ${p.reason}`}><Trash2 size={16} /></button>
        </li>)}
      </ul> : <p className="panel-note">Nenhuma penalidade.</p>}
      <form className="admin-form" onSubmit={e => void addPenalty(e)}>
        <div className="admin-duel-fields">
          <label className="admin-field">
            <span>Pontos a tirar</span>
            <input type="number" min={1} max={1000} inputMode="numeric" required placeholder="10" value={penalty.points} onChange={e => setPenalty({ ...penalty, points: e.target.value })} />
          </label>
          <label className="admin-field">
            <span>Prova</span>
            <select value={penalty.race} onChange={e => setPenalty({ ...penalty, race: e.target.value })}>
              <option value="">Geral</option>
              {races.map(r => <option key={r.id} value={r.id}>Prova {r.number}</option>)}
            </select>
          </label>
        </div>
        <label className="admin-field">
          <span>Motivo (aparece no app)</span>
          <input required maxLength={120} placeholder="Ex.: corte de boia" value={penalty.reason} onChange={e => setPenalty({ ...penalty, reason: e.target.value })} />
        </label>
        <button className="button" type="submit" disabled={busy}><Plus size={16} /> Aplicar penalidade</button>
      </form>
    </section>
  </>;
}

// ---------------------------------------------------------------------
// Notificação geral
// ---------------------------------------------------------------------

const TITLE_MAX = 65;
const BODY_MAX = 240;

function NotifyPanel() {
  const { notify } = useApp();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ title: string; sent_at: string }[] | null>(null);
  const loadRecent = () => supabase.rpc('recent_announcements', { p_limit: 10 }).then(({ data }) => setRecent(data ?? []));
  useEffect(() => { void loadRecent(); }, []);
  const ready = title.trim() !== '' && body.trim() !== '';

  async function send() {
    setBusy(true);
    const { error } = await supabase.rpc('send_announcement', { p_title: title.trim(), p_body: body.trim() });
    setBusy(false);
    setConfirm(false);
    if (error) { notify(errorMessage(error)); return; }
    setTitle(''); setBody('');
    notify('Notificação enviada para todos.');
    // O envio acontece logo depois, pela Edge Function: o histórico atualiza em seguida.
    setTimeout(() => void loadRecent(), 3000);
  }

  return <>
    <section className="settings-group">
      <h2 className="settings-label">Notificação para todo mundo</h2>
      <form className="settings-card settings-row admin-form" onSubmit={e => { e.preventDefault(); if (ready) setConfirm(true); }}>
        <label className="admin-field">
          <span>Título <small>{title.length}/{TITLE_MAX}</small></span>
          <input required maxLength={TITLE_MAX} placeholder="Ex.: Prova 3 adiada para 15h" value={title} onChange={e => setTitle(e.target.value)} />
        </label>
        <label className="admin-field">
          <span>Texto <small>{body.length}/{BODY_MAX}</small></span>
          <textarea required maxLength={BODY_MAX} rows={3} placeholder="Ex.: Vento forte na raia. Acompanhe a largada ao vivo no app." value={body} onChange={e => setBody(e.target.value)} />
        </label>
        <div className="push-preview" aria-label="Prévia da notificação">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <div><strong>{title.trim() || 'Título'}</strong><p>{body.trim() || 'Texto da notificação'}</p></div>
        </div>
        <button className="button primary" type="submit" disabled={!ready}><Send size={16} /> Enviar para todos</button>
      </form>
      <p className="settings-hint">Chega no celular de quem tem o app instalado e deixou “Anúncios gerais” ligado em Configurações.</p>
    </section>

    <section className="settings-group">
      <h2 className="settings-label">Enviadas recentemente</h2>
      <div className="settings-card">
        {!recent ? <p className="panel-note">Carregando…</p>
          : !recent.length ? <p className="panel-note">Nenhuma notificação enviada ainda.</p>
          : <ul className="admin-list">{recent.map(r => <li key={r.sent_at} className="settings-row settings-split">
              <div><h3>{r.title}</h3></div>
              <small className="admin-when">{new Date(r.sent_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</small>
            </li>)}</ul>}
      </div>
    </section>

    <Sheet open={confirm} onClose={() => setConfirm(false)} title="Enviar para todo mundo?">
      <div className="prose">
        <div className="push-preview">
          <img src="/icons/icon-192.png" alt="" width={36} height={36} />
          <div><strong>{title.trim()}</strong><p>{body.trim()}</p></div>
        </div>
        <p>A notificação vai para todos os aparelhos de uma vez. <strong>Não dá para desfazer.</strong></p>
        <div className="account-actions">
          <button className="button" onClick={() => setConfirm(false)} autoFocus>Cancelar</button>
          <button className="button primary" disabled={busy} onClick={() => void send()}><Megaphone size={16} /> {busy ? 'Enviando…' : 'Enviar agora'}</button>
        </div>
      </div>
    </Sheet>
  </>;
}

// ---------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------

function LivePanel() {
  const { notify } = useApp();
  const [current, setCurrent] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void supabase.from('event_settings').select('live_url').maybeSingle().then(({ data }) => setCurrent(data?.live_url ?? ''));
  }, []);
  const value = draft ?? current ?? '';
  const embed = youtubeEmbedUrl(value.trim());
  const changed = current !== null && value.trim() !== current;

  async function save(url: string) {
    setBusy(true);
    const { error } = await supabase.rpc('set_live_url', { p_url: url });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    setCurrent(url);
    setDraft(null);
    notify(url ? 'Transmissão trocada. Quem está assistindo já vê o novo vídeo.' : 'Live fora do ar.');
  }

  return <section className="settings-group">
    <h2 className="settings-label">Transmissão ao vivo</h2>
    <form className="settings-card settings-row admin-form" onSubmit={e => { e.preventDefault(); if (embed && changed) void save(value.trim()); }}>
      <div className="settings-split">
        <div><h3>{current ? 'No ar' : 'Fora do ar'}</h3><p>{current ? current : 'Sem link, a aba Live mostra “A transmissão começa em breve”.'}</p></div>
        <span className={`live-state ${current ? 'on' : ''}`}><Radio size={14} /> {current ? 'Ao vivo' : 'Desligada'}</span>
      </div>
      <label className="admin-field">
        <span>Link do YouTube</span>
        <input type="url" inputMode="url" placeholder="https://www.youtube.com/live/…" disabled={current === null} value={value} onChange={e => setDraft(e.target.value)} />
      </label>
      {value.trim() && !embed && <p className="form-error" role="alert">Link não reconhecido. Use youtube.com/watch?v=…, youtube.com/live/… ou youtu.be/…</p>}
      {embed && changed && <div className="admin-live-preview"><iframe src={embed} title="Prévia da nova transmissão" allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" /></div>}
      <div className="account-actions">
        {current && <button className="button danger" type="button" disabled={busy} onClick={() => void save('')}>Tirar do ar</button>}
        <button className="button primary" type="submit" disabled={!embed || !changed || busy}><Check size={16} /> {busy ? 'Salvando…' : 'Trocar transmissão'}</button>
      </div>
    </form>
    <p className="settings-hint">A troca vale na hora para quem está com a live aberta no app, sem precisar publicar uma nova versão.</p>
  </section>;
}
