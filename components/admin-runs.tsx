'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Flag, Square, Trash2, X } from 'lucide-react';
import { useApp } from './app-shell';
import { DuelClock, RowInfo, StartRow, StatusForm } from './admin';
import { Sheet, TeamBadge } from './ui';
import { supabase, errorMessage } from '@/lib/supabase';
import type { Race, Team } from '@/lib/data';
import { useRaceRuns, type ResultsData } from '@/lib/results';
import { byTeamName } from '@/lib/names';
import {
  SLALOM_ATTEMPTS, SLALOM_PAUSE, SLALOM_WINDOW, formatDuel, formatDuration, isRunning, nextAttempt, parseDuel, slalomStart, sprintFinalists,
  type Run, type Score,
} from '@/lib/scoring';

// Slalom (attempts) e Sprint (heats): provas de tempo. Cada linha de race_runs é uma tentativa do
// Slalom ou a participação do barco numa bateria do Sprint. O tempo é medido neste aparelho: o toque
// de chegada menos a largada.

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
const runKey = (teamId: string, run: number) => `${teamId}|${run}`;
const runLabel = (race: Race, run: number) => race.kind === 'heats' ? `Bateria ${run}` : `${run}ª tentativa`;
/** Instante do toque (só em evento; o lint não segue a chamada dentro do botão de encerrar). */
const tapTime = () => Date.now();
const elapsed = (start: number, at: number) => Math.max(0.1, Math.round((at - start) / 100) / 10);

/** Tentativas da prova com o que acabou de ser marcado aqui por cima (o tempo real chega com atraso). */
function useLiveRuns(race: Race) {
  const { notify } = useApp();
  const { runs: server, reload } = useRaceRuns(race.id);
  // null: apagada aqui e ainda não confirmada pelo banco.
  const [overlay, setOverlay] = useState<Map<string, Run | null>>(new Map());
  const runs = useMemo(() => {
    const list = new Map((server ?? []).map(r => [runKey(r.team_id, r.run), r]));
    for (const [key, run] of overlay) if (run) list.set(key, run); else list.delete(key);
    return [...list.values()];
  }, [server, overlay]);

  const put = (changes: [string, Run | null][]) => setOverlay(current => { const next = new Map(current); for (const [k, v] of changes) next.set(k, v); return next; });
  // Confirmado no banco: busca de novo e solta o que foi marcado aqui.
  const settle = async (keys: string[]) => {
    await reload();
    setOverlay(current => { const next = new Map(current); for (const k of keys) next.delete(k); return next; });
  };

  async function start(teamIds: string[], run: number, at: number) {
    const rows = teamIds.map(team_id => ({ race_id: race.id, team_id, run, started_at: new Date(at).toISOString(), ended_at: null, seconds: null }));
    put(rows.map(r => [runKey(r.team_id, run), r]));
    const { error } = await supabase.rpc('admin_start_runs', { p_race_id: race.id, p_run: run, p_team_ids: teamIds, p_at: new Date(at).toISOString() });
    // A largada já está valendo neste aparelho: a chegada é medida daqui mesmo sem internet.
    if (error) { notify('A largada não chegou ao app (o relógio daqui segue valendo).', { label: 'Tentar de novo', run: () => void start(teamIds, run, at) }); return; }
    await settle(rows.map(r => runKey(r.team_id, run)));
  }
  /** Chegada com tempo, ou fim sem tempo (`withTime` falso). */
  async function finish(run: Run, at: number, withTime: boolean, name: string) {
    const startedAt = Date.parse(run.started_at!);
    const seconds = withTime ? elapsed(startedAt, at) : null;
    const key = runKey(run.team_id, run.run);
    put([[key, { ...run, ended_at: new Date(at).toISOString(), seconds }]]);
    const { error } = await supabase.rpc('admin_set_run', { p_race_id: race.id, p_team_id: run.team_id, p_run: run.run, p_seconds: seconds, p_at: new Date(at).toISOString() });
    if (error) { notify(`Não gravou ${seconds !== null ? formatDuel(seconds) : 'o sem tempo'} de ${name}.`, { label: 'Tentar de novo', run: () => void finish(run, at, withTime, name) }); return; }
    await settle([key]);
    notify(seconds !== null ? `${name}: ${formatDuel(seconds)}` : `${name} ficou sem tempo.`, { label: 'Desfazer', run: () => void start([run.team_id], run.run, startedAt) });
  }
  async function cancel(run: Run, name: string) {
    const key = runKey(run.team_id, run.run);
    put([[key, null]]);
    const { error } = await supabase.rpc('admin_delete_run', { p_race_id: race.id, p_team_id: run.team_id, p_run: run.run });
    if (error) { put([[key, run]]); notify(errorMessage(error)); return; }
    await settle([key]);
    if (run.started_at) notify(`Largada de ${name} cancelada.`, { label: 'Desfazer', run: () => void start([run.team_id], run.run, Date.parse(run.started_at!)) });
  }
  return { runs, loaded: server !== null, start, finish, cancel, reload };
}

/** Relógio da última chegada no Slalom: até 3 min para o próximo largar. */
function NextWindow({ end }: { end: number }) {
  // Vazio até o primeiro tique: sem mostrar 3:00 por um instante quando a chegada já é antiga.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0), id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  const limit = end + SLALOM_WINDOW;
  if (now === null || now >= limit + SLALOM_PAUSE) return null;
  return <p className={`admin-run-window ${now >= limit ? 'late' : ''}`}>
    {now < limit
      ? <>Próximo barco larga em até <strong>{formatDuration(limit - now)}</strong></>
      : <>Passou dos 3 min (fim às <strong>{clock.format(limit)}</strong>): ao largar, dá para contar desde esse horário</>}
  </p>;
}

/** Tentativas de um barco numa linha: 1:02,4 · sem tempo · na água. */
function runsText(race: Race, runs: Run[], teamId: string) {
  const mine = runs.filter(r => r.team_id === teamId).sort((a, b) => a.run - b.run);
  if (!mine.length) return race.kind === 'heats' ? 'Não correu' : 'Nenhuma tentativa';
  return mine.map(r => `${race.kind === 'heats' ? `B${r.run}` : `${r.run}ª`} ${isRunning(r) ? 'na água' : r.seconds !== null ? formatDuel(r.seconds) : 'sem tempo'}`).join(' · ');
}

export function AttemptsAdmin({ race, data, onRaceChanged }: { race: Race; data: ResultsData; onRaceChanged: () => Promise<void> }) {
  const live = useLiveRuns(race);
  const [sheet, setSheet] = useState<{ team: string; open: boolean } | null>(null);
  const teams = [...data.teams].sort(byTeamName);
  const names = new Map(teams.map(t => [t.id, t.name]));
  const scores = new Map(data.scores.filter(s => s.race_id === race.id).map(s => [s.team_id, s]));
  const running = live.runs.filter(isRunning);
  // Só chegada de barco que largou de verdade abre os 3 min (tempo digitado à mão não conta).
  const ends = live.runs.filter(r => r.started_at && r.ended_at).map(r => Date.parse(r.ended_at!));
  const lastEnd = ends.length ? Math.max(...ends) : null;
  const { notify } = useApp();
  const selected = teams.find(t => t.id === sheet?.team) ?? null;

  // Conta sempre do toque. Passou dos 3 min, o fim da janela fica como opção: a "última chegada"
  // pode ser antiga (largada cancelada, tentativa apagada) e contar dela sozinho dá tempo errado.
  function launch(team: Team, attempt: number, tap: number) {
    const late = slalomStart(tap, lastEnd);
    void live.start([team.id], attempt, tap);
    if (late !== tap) notify(`${team.name} largou mais de 3 min depois da última chegada.`, { label: `Contar desde ${clock.format(late)}`, run: () => void live.start([team.id], attempt, late) });
  }

  return <>
    <section className="settings-group">
      <div className="settings-card"><StartRow race={race} onRaceChanged={onRaceChanged} /></div>
    </section>
    <p className="settings-hint admin-duel-how">Um barco por vez, até {SLALOM_ATTEMPTS} tentativas; vale o melhor tempo. Toque em Largar quando o barco abrir a volta e em Chegou na chegada. O tempo conta do toque em Largar. Se passar dos 3 min depois da chegada do anterior, o aviso da largada oferece contar do fim dos 3 min.</p>
    {running.length > 0
      ? <section className="settings-group" aria-label="Na água">
        <h2 className="settings-label">Na água</h2>
        <ul className="settings-card admin-list">
          {running.map(run => {
            const name = names.get(run.team_id) ?? run.team_id;
            return <li key={runKey(run.team_id, run.run)} className="admin-duel-row">
              <div className="admin-duel-live admin-run-live">
                <div><span className="admin-run-who"><strong>{name}</strong><small>{runLabel(race, run.run)}</small></span><DuelClock start={Date.parse(run.started_at!)} /></div>
                <button className="button primary" onClick={() => void live.finish(run, Date.now(), true, name)}><Check size={18} /> Chegou: {name}</button>
                <div className="admin-run-actions">
                  <button className="button" onClick={() => void live.finish(run, Date.now(), false, name)}><X size={16} /> Sem tempo</button>
                  <button className="button ghost" onClick={() => void live.cancel(run, name)}>Cancelar largada</button>
                </div>
              </div>
            </li>;
          })}
        </ul>
      </section>
      : lastEnd !== null && <NextWindow key={lastEnd} end={lastEnd} />}

    <section className="settings-group" aria-labelledby="admin-attempts">
      <h2 id="admin-attempts" className="settings-label">Equipes · toque em Largar quando o barco abrir a volta</h2>
      <ul className="settings-card admin-list">
        {teams.map(team => {
          const next = nextAttempt(live.runs, team.id);
          const score = scores.get(team.id);
          return <li key={team.id} className="admin-row">
            <button className="admin-row-info" onClick={() => setSheet({ team: team.id, open: true })} aria-haspopup="dialog">
              <RowInfo team={team} score={score} detail={[runsText(race, live.runs, team.id), score?.note].filter(Boolean).join(' · ')} />
            </button>
            <button className="button lap-button" disabled={!live.loaded || !next || running.length > 0 || score?.status === 'dns'}
              onClick={() => next && launch(team, next, Date.now())} aria-label={next ? `Largar ${team.name}, ${next}ª tentativa` : `${team.name} já fez as ${SLALOM_ATTEMPTS} tentativas`}>
              <Flag size={18} /> {next ? `Largar ${next}ª` : 'Feitas'}
            </button>
          </li>;
        })}
      </ul>
    </section>
    <TeamSheet race={race} team={selected} open={!!sheet?.open} runs={live.runs} onClose={() => setSheet(s => s && { ...s, open: false })} onChanged={live.reload} />
  </>;
}

export function HeatsAdmin({ race, data, onRaceChanged }: { race: Race; data: ResultsData; onRaceChanged: () => Promise<void> }) {
  const live = useLiveRuns(race);
  const [sheet, setSheet] = useState<{ team: string; open: boolean } | null>(null);
  const teams = [...data.teams].sort(byTeamName);
  const scores = new Map(data.scores.filter(s => s.race_id === race.id).map(s => [s.team_id, s]));
  const selected = teams.find(t => t.id === sheet?.team) ?? null;
  const heat1Running = live.runs.some(r => r.run === 1 && isRunning(r));

  return <>
    <section className="settings-group">
      <div className="settings-card"><StartRow race={race} onRaceChanged={onRaceChanged} /></div>
    </section>
    <p className="settings-hint admin-duel-how">Todos largam juntos: toque em Largada na buzina e em Chegou quando cada barco cruzar a chegada. Os 3 primeiros da bateria 1 fazem a bateria 2, que define o pódio.</p>
    {[1, 2].map(heat => <Heat key={heat} race={race} heat={heat} teams={teams} scores={scores} live={live}
      defaults={heat === 1 ? teams.filter(t => scores.get(t.id)?.status !== 'dns').map(t => t.id) : sprintFinalists(live.runs)}
      blocked={!live.loaded ? 'Carregando…' : heat === 2 && (heat1Running || !live.runs.some(r => r.run === 1 && r.seconds !== null)) ? 'Libera quando a bateria 1 terminar.' : null}
      onTeam={id => setSheet({ team: id, open: true })} />)}

    <section className="settings-group" aria-labelledby="admin-heats-status">
      <h2 id="admin-heats-status" className="settings-label">Situação dos barcos</h2>
      <ul className="settings-card admin-list">
        {teams.map(team => <li key={team.id} className="admin-row">
          <button className="admin-row-info" onClick={() => setSheet({ team: team.id, open: true })} aria-haspopup="dialog">
            <RowInfo team={team} score={scores.get(team.id)} detail={[runsText(race, live.runs, team.id), scores.get(team.id)?.note].filter(Boolean).join(' · ')} />
          </button>
        </li>)}
      </ul>
    </section>
    <TeamSheet race={race} team={selected} open={!!sheet?.open} runs={live.runs} onClose={() => setSheet(s => s && { ...s, open: false })} onChanged={live.reload} />
  </>;
}

type Live = ReturnType<typeof useLiveRuns>;

/** Uma bateria do Sprint: escolha dos barcos, largada geral, chegadas e o resultado. */
function Heat({ race, heat, teams, scores, live, defaults, blocked, onTeam }: {
  race: Race; heat: number; teams: Team[]; scores: Map<string, Score>; live: Live; defaults: string[]; blocked: string | null; onTeam: (id: string) => void;
}) {
  const { notify } = useApp();
  const rows = live.runs.filter(r => r.run === heat);
  const running = rows.filter(isRunning);
  const names = new Map(teams.map(t => [t.id, t.name]));
  // Barcos escolhidos para largar; até mexer, vale a sugestão (todos, ou os 3 primeiros da bateria 1).
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? defaults;
  // Bateria 2: só quem fez tempo na bateria 1, do mais rápido para o mais lento.
  const heat1 = live.runs.filter(r => r.run === 1 && r.seconds !== null).sort((a, b) => a.seconds! - b.seconds!);
  const candidates = heat === 1 ? teams : heat1.flatMap(r => teams.filter(t => t.id === r.team_id));
  const title = heat === 1 ? 'Bateria 1 · todos os barcos' : 'Bateria 2 · os 3 primeiros, vale o pódio';

  if (!rows.length) return <section className="settings-group" aria-label={title}>
    <h2 className="settings-label">{title}</h2>
    <div className="settings-card">
      {blocked ? <p className="panel-note">{blocked}</p> : <>
        {candidates.map(team => {
          const on = chosen.includes(team.id);
          return <label key={team.id} className="settings-split admin-extra toggle-row admin-heat-pick">
            <span className="admin-heat-team"><TeamBadge team={team} small /><strong>{team.name}</strong></span>
            <button type="button" role="switch" className="toggle" aria-checked={on} aria-label={`${team.name} na bateria ${heat}`}
              onClick={() => setPicked(on ? chosen.filter(id => id !== team.id) : [...chosen, team.id])}><span /></button>
          </label>;
        })}
        <div className="admin-heat-go">
          <button className="button primary" disabled={!chosen.length} onClick={() => { setPicked(null); void live.start(chosen, heat, Date.now()); }}>
            <Flag size={18} /> Largada da bateria {heat} · {chosen.length} {chosen.length === 1 ? 'barco' : 'barcos'}
          </button>
        </div>
      </>}
    </div>
  </section>;

  const start = Math.min(...rows.filter(r => r.started_at).map(r => Date.parse(r.started_at!)));
  // Ordem fixa enquanto corre (o botão não foge do dedo); depois, a ordem de chegada.
  const order = running.length ? [...rows].sort((a, b) => byTeamName({ name: names.get(a.team_id) ?? '' }, { name: names.get(b.team_id) ?? '' }))
    : [...rows].sort((a, b) => (a.seconds ?? Infinity) - (b.seconds ?? Infinity));
  const arrived = rows.filter(r => r.seconds !== null).sort((a, b) => a.seconds! - b.seconds!);

  async function closeHeat(at: number) {
    const { error } = await supabase.rpc('admin_close_runs', { p_race_id: race.id, p_run: heat, p_at: new Date(at).toISOString() });
    if (error) { notify(errorMessage(error)); return; }
    await live.reload();
    const left = running.map(r => r.team_id);
    notify(`Bateria ${heat} encerrada: ${left.length} ${left.length === 1 ? 'barco ficou' : 'barcos ficaram'} sem tempo.`, { label: 'Desfazer', run: () => void live.start(left, heat, start) });
  }
  async function cancelHeat() {
    for (const row of rows) await live.cancel(row, names.get(row.team_id) ?? row.team_id);
  }

  return <section className="settings-group" aria-label={title}>
    <h2 className="settings-label">{title}</h2>
    <ul className="settings-card admin-list">
      {running.length > 0 && <li className="admin-duel-row">
        <div className="admin-duel-live admin-run-live">
          <div><DuelClock start={start} />
            {arrived.length
              ? <button className="button" onClick={() => void closeHeat(tapTime())}><Square size={14} /> Encerrar ({running.length} sem tempo)</button>
              : <button className="button ghost" onClick={() => void cancelHeat()}><X size={16} /> Cancelar largada</button>}
          </div>
          {order.map(row => {
            const name = names.get(row.team_id) ?? row.team_id;
            const place = arrived.indexOf(row) + 1;
            return <button key={row.team_id} className="button primary" disabled={!isRunning(row)} onClick={() => void live.finish(row, Date.now(), true, name)}>
              <Check size={18} /> {isRunning(row) ? `Chegou: ${name}` : `${name} · ${row.seconds !== null ? `${place}º · ${formatDuel(row.seconds)}` : 'sem tempo'}`}
            </button>;
          })}
        </div>
      </li>}
      {!running.length && order.map(row => {
        const team = teams.find(t => t.id === row.team_id);
        const place = row.seconds !== null ? arrived.indexOf(row) + 1 : null;
        return team && <li key={row.team_id} className="admin-row">
          <button className="admin-row-info" onClick={() => onTeam(row.team_id)} aria-haspopup="dialog">
            <span className={`position-badge ${place && place <= 3 ? `p${place}` : ''}`}>{place ? `${place}º` : '–'}</span>
            <TeamBadge team={team} small />
            <span className="admin-row-main"><strong>{team.name}</strong><small>{row.seconds !== null ? formatDuel(row.seconds) : 'Sem tempo'}{scores.get(row.team_id)?.note ? ` · ${scores.get(row.team_id)!.note}` : ''}</small></span>
          </button>
        </li>;
      })}
    </ul>
  </section>;
}

/** Sheet de um barco: as tentativas (ou baterias) para corrigir à mão e a situação na prova. */
function TeamSheet({ race, team, open, runs, onClose, onChanged }: {
  race: Race; team: Team | null; open: boolean; runs: Run[]; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const max = race.kind === 'heats' ? 2 : SLALOM_ATTEMPTS;
  return <Sheet open={open} onClose={onClose} title={team?.name ?? 'Equipe'} subtitle={`Prova ${race.number} · ${race.name}`}>
    {team && <>
      <section className="admin-sheet-section">
        <h3>{race.kind === 'heats' ? 'Baterias' : 'Tentativas'}</h3>
        <ol className="lap-list">
          {Array.from({ length: max }, (_, i) => i + 1).map(n => {
            const run = runs.find(r => r.team_id === team.id && r.run === n) ?? null;
            return <RunField key={`${n}:${run?.seconds ?? ''}:${run ? 1 : 0}`} race={race} team={team} n={n} run={run} onChanged={onChanged} />;
          })}
        </ol>
        <p className="settings-hint">Digite o tempo como 1.02,4 (minuto e segundos) ou 62,4 (só segundos). Vazio grava sem tempo. Equipe que largou e não fez nenhum tempo fica DNF sozinha.</p>
      </section>
      <StatusForm key={team.id} race={race} team={team} />
    </>}
  </Sheet>;
}

function RunField({ race, team, n, run, onChanged }: { race: Race; team: Team; n: number; run: Run | null; onChanged: () => Promise<void> }) {
  const { notify } = useApp();
  const [text, setText] = useState(run?.seconds != null ? formatDuel(run.seconds) : '');
  const [busy, setBusy] = useState(false);
  const running = !!run && isRunning(run);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const seconds = text.trim() ? parseDuel(text) : null;
    if (text.trim() && seconds === null) { notify('Tempo inválido. Use 1.02,4 (minuto e segundos) ou 62,4 (só segundos).'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_run', { p_race_id: race.id, p_team_id: team.id, p_run: n, p_seconds: seconds });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    await onChanged();
    notify(`${runLabel(race, n)} de ${team.name}: ${seconds !== null ? formatDuel(seconds) : 'sem tempo'}.`);
  }
  async function remove() {
    if (!run) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_delete_run', { p_race_id: race.id, p_team_id: team.id, p_run: n });
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    await onChanged();
    notify(`${runLabel(race, n)} de ${team.name} apagada.`, run.seconds !== null
      ? { label: 'Desfazer', run: () => void supabase.rpc('admin_set_run', { p_race_id: race.id, p_team_id: team.id, p_run: n, p_seconds: run.seconds }).then(() => onChanged()) }
      : undefined);
  }

  return <li className="admin-run-field">
    <span className="lap-number">{race.kind === 'heats' ? `B${n}` : n}</span>
    <form className="admin-inline-form" onSubmit={e => void save(e)}>
      <label className="admin-field">
        <span>{runLabel(race, n)}{running ? ' · na água agora' : run && run.seconds === null ? ' · sem tempo' : !run ? ' · não corrida' : ''}</span>
        <input inputMode="decimal" placeholder={running ? 'Na água' : '1.02,4'} value={text} onChange={e => setText(e.target.value)} />
      </label>
      <button className="button" type="submit" disabled={busy}><Check size={16} /> Salvar</button>
      {run && <button className="icon-button danger" type="button" disabled={busy} onClick={() => void remove()} aria-label={`Apagar ${runLabel(race, n)}`}><Trash2 size={16} /></button>}
    </form>
  </li>;
}
