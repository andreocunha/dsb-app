'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, CircleHelp, Copy, Lock, Trophy, Users } from 'lucide-react';
import { PICKS_PER_RACE, useRaceResults, useRaces, useTeams, type RaceResult, type Team } from '@/lib/data';
import { hasStarted, nextRace, raceDate, raceTime, useNow } from '@/lib/races';
import { supabase, errorMessage } from '@/lib/supabase';
import { useApp } from './app-shell';
import { useAuth } from './auth';
import { Avatar, Sheet, TeamBadge } from './ui';

type Lineup = { team_ids: string[]; double_team_id: string | null };
type Lineups = Record<string, Lineup>;
type RankingRow = { user_id: string; name: string; avatar_url: string | null; points: number; position: number };
const empty: Lineup = { team_ids: [], double_team_id: null };

const fetchRanking = async () =>
  ((await supabase.rpc('fantasy_ranking', { p_limit: 100 })).data as RankingRow[] | null) ?? [];
// RLS devolve só as escalações da própria pessoa.
const fetchLineups = async (): Promise<Lineups> =>
  Object.fromEntries(((await supabase.from('fantasy_lineups').select('race_id, team_ids, double_team_id')).data ?? [])
    .map(row => [row.race_id, { team_ids: row.team_ids, double_team_id: row.double_team_id }]));

/** Pontos de uma escalação numa prova, já com o dobro do barco marcado com 2x. */
const lineupPoints = (lineup: Lineup, results: RaceResult[], raceId: string) =>
  lineup.team_ids.reduce((total, id) => {
    const points = results.find(r => r.race_id === raceId && r.team_id === id)?.points ?? 0;
    return total + points * (id === lineup.double_team_id ? 2 : 1);
  }, 0);

export function Fantasy() {
  const { userId, requireLogin } = useAuth();
  const { notify } = useApp();
  const now = useNow();
  const { data: races } = useRaces();
  const { data: teams } = useTeams();
  const results = useRaceResults();
  const [lineups, setLineups] = useState<Lineups>({});
  const [ranking, setRanking] = useState<RankingRow[] | null>(null);
  const [view, setView] = useState<'ranking' | 'meu'>('ranking');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rules, setRules] = useState(false);

  const loadRanking = useCallback(() => fetchRanking().then(setRanking), []);
  const loadLineups = useCallback(() => fetchLineups().then(setLineups), []);
  useEffect(() => { void fetchRanking().then(setRanking); }, [userId]);
  useEffect(() => { if (userId) void fetchLineups().then(setLineups); }, [userId]);

  if (!races || !teams || !results) return <div className="page fantasy"><div className="page-heading"><div><h1>Fantasy</h1><p>Carregando provas e barcos…</p></div></div></div>;

  const race = races.find(r => r.id === selectedId) ?? nextRace(races, now);
  const lineup = (userId && lineups[race.id]) || empty;
  const isLocked = hasStarted(race, now);
  const picked = (id: string) => lineup.team_ids.includes(id);

  async function save(next: Lineup) {
    const previous = lineup;
    setLineups(current => ({ ...current, [race.id]: next }));
    const { error } = await supabase.rpc('save_lineup', { p_race_id: race.id, p_team_ids: next.team_ids, p_double: next.double_team_id });
    if (error) { setLineups(current => ({ ...current, [race.id]: previous })); notify(errorMessage(error)); return; }
    void loadRanking();
  }

  function toggleTeam(team: Team) {
    if (!userId) { requireLogin('Entre para montar seu fantasy e disputar o ranking.'); return; }
    if (isLocked) return;
    if (picked(team.id)) {
      const team_ids = lineup.team_ids.filter(id => id !== team.id);
      void save({ team_ids, double_team_id: lineup.double_team_id === team.id ? null : lineup.double_team_id });
      return;
    }
    if (lineup.team_ids.length >= PICKS_PER_RACE) { notify(`Você já escolheu ${PICKS_PER_RACE} barcos. Toque em um deles para trocar.`); return; }
    void save({ ...lineup, team_ids: [...lineup.team_ids, team.id] });
  }

  function toggleDouble(team: Team) {
    if (isLocked) return;
    void save({ ...lineup, double_team_id: lineup.double_team_id === team.id ? null : team.id });
  }

  async function copyForward() {
    const { error } = await supabase.rpc('copy_lineup_forward', { p_race_id: race.id });
    if (error) { notify(errorMessage(error)); return; }
    await loadLineups();
    notify('Escalação repetida em todas as próximas provas.');
  }

  const raceResults = results.filter(r => r.race_id === race.id)
    .map(r => ({ ...r, team: teams.find(t => t.id === r.team_id) }))
    .filter(r => r.team)
    .sort((a, b) => b.points - a.points);
  const myRacePoints = lineupPoints(lineup, results, race.id);

  const raceChips = <div className="race-list" role="tablist" aria-label="Provas">
    {races.map(r => {
      const count = (userId && lineups[r.id]?.team_ids.length) || 0;
      const locked = hasStarted(r, now);
      const scored = results.some(result => result.race_id === r.id);
      return <button key={r.id} role="tab" aria-selected={r.id === race.id} onClick={() => setSelectedId(r.id)}>
        <span className="race-number">Prova {r.number}</span>
        <strong>{r.name}</strong>
        <small>{raceDate(r)} · {raceTime(r)}</small>
        <span className={`race-status ${scored ? 'done' : locked ? 'locked' : count === PICKS_PER_RACE ? 'done' : ''}`}>
          {scored ? <><Trophy size={11} /> Resultado</> : locked ? <><Lock size={11} /> Encerrada</> : `${count}/${PICKS_PER_RACE}`}
        </span>
      </button>;
    })}
  </div>;

  return <div className="page fantasy">
    <div className="page-heading">
      <div><h1>Fantasy</h1><p>Escolha {PICKS_PER_RACE} barcos por prova e dobre os pontos de um deles.</p></div>
      <button className="button" onClick={() => setRules(true)}><CircleHelp size={16} /> Como jogar</button>
    </div>

    <div className="segmented fantasy-tabs" role="tablist" aria-label="Seções do fantasy">
      <button role="tab" aria-selected={view === 'ranking'} onClick={() => setView('ranking')}><Trophy size={16} /> Resultados</button>
      <button role="tab" aria-selected={view === 'meu'} onClick={() => setView('meu')}><Users size={16} /> Meu fantasy</button>
    </div>

    {view === 'ranking' ? <div className="fantasy-grid">
      <section className="card ranking wide">
        <div className="ranking-heading"><h2>Ranking da torcida</h2>{ranking && <span className="tag">{ranking.length} {ranking.length === 1 ? 'participante' : 'participantes'}</span>}</div>
        {ranking === null ? <p className="panel-note">Carregando…</p>
          : ranking.length === 0 ? <p className="panel-note">Ninguém montou o fantasy ainda. Seja o primeiro!</p>
          : <ol>
            {ranking.map(player => <li key={player.user_id} className={player.user_id === userId ? 'you' : ''}>
              <span className={`position p${player.position}`}>{player.position}</span>
              <Avatar id={player.user_id} name={player.name} url={player.avatar_url} small />
              <span className="ranking-name">{player.name}{player.user_id === userId && <small> (você)</small>}</span>
              <strong>{player.points}<small> pts</small></strong>
            </li>)}
          </ol>}
      </section>

      <section className="card race-results">
        <div className="ranking-heading"><h2>Prova {race.number} · {race.name}</h2></div>
        {raceChips}
        {raceResults.length === 0
          ? <p className="panel-note">{isLocked ? 'Resultado ainda não publicado.' : `A prova começa em ${raceDate(race)}, ${raceTime(race)}.`}</p>
          : <>
            <ol className="results">
              {raceResults.map((result, index) => <li key={result.team_id} className={picked(result.team_id) ? 'mine' : ''}>
                <span className="position">{index + 1}</span>
                <TeamBadge team={result.team!} small />
                <span className="results-team"><strong>{result.team!.name}</strong><small>{result.team!.university.split(' · ')[0]}</small></span>
                {lineup.double_team_id === result.team_id && <span className="double-tag">2x</span>}
                <strong>{result.points}<small> pts</small></strong>
              </li>)}
            </ol>
            {lineup.team_ids.length > 0 && <p className="race-total">Sua pontuação nesta prova: <strong>{myRacePoints} pts</strong></p>}
          </>}
      </section>
    </div> : <div className="fantasy-grid">
      <section className="card lineup wide">
        <div className="lineup-heading">
          <div>
            <h2>Prova {race.number} · {race.name}</h2>
            <p>{isLocked ? 'Escalação travada: a prova já largou.' : `Você pode trocar os barcos até ${raceDate(race)}, ${raceTime(race)}.`}</p>
          </div>
          {!isLocked && lineup.team_ids.length > 0 && race !== races[races.length - 1] && <button className="button" onClick={() => void copyForward()}><Copy size={15} /> Repetir nas próximas</button>}
        </div>
        {raceChips}
        <p className="picks-counter">
          <strong>{lineup.team_ids.length}/{PICKS_PER_RACE}</strong> barcos escolhidos
          {lineup.double_team_id && <> · 2x em <strong>{teams.find(t => t.id === lineup.double_team_id)?.name}</strong></>}
        </p>
        <div className="boat-grid">
          {teams.map(team => {
            const selected = picked(team.id);
            const doubled = lineup.double_team_id === team.id;
            return <div key={team.id} className={`boat-card ${selected ? 'selected' : ''}`}>
              <button className="boat-pick" disabled={isLocked} onClick={() => toggleTeam(team)} aria-pressed={selected} aria-label={`${selected ? 'Remover' : 'Escolher'} ${team.name}`}>
                <TeamBadge team={team} />
                <span className="boat-name"><strong>{team.name}</strong><small>{team.university.split(' · ')[0]}</small></span>
                <span className="boat-points">{team.points}<small> pts</small></span>
                {selected && <span className="boat-check"><Check size={14} /></span>}
              </button>
              {selected && !isLocked && <button className={`double-toggle ${doubled ? 'on' : ''}`} onClick={() => toggleDouble(team)} aria-pressed={doubled} aria-label={`${doubled ? 'Remover' : 'Aplicar'} o 2x em ${team.name}`}>2x</button>}
              {selected && isLocked && doubled && <span className="double-tag">2x</span>}
            </div>;
          })}
        </div>
      </section>
    </div>}

    <Sheet open={rules} onClose={() => setRules(false)} title="Como jogar">
      <ol className="rules">
        <li><strong>Escolha {PICKS_PER_RACE} barcos por prova</strong><p>São {races.length} provas, e a escolha é separada para cada uma.</p></li>
        <li><strong>Use o 2x</strong><p>Um dos seus barcos pode valer o dobro dos pontos na prova. Escolha com estratégia.</p></li>
        <li><strong>Troque até a largada</strong><p>Dá para mudar os barcos até o horário de início da prova. Depois disso, trava.</p></li>
        <li><strong>Acompanhe o ranking</strong><p>Quando a organização publica o resultado, os pontos dos seus barcos entram na sua soma.</p></li>
      </ol>
      <p className="footnote">Fantasy gratuito, sem apostas ou prêmios em dinheiro.</p>
    </Sheet>
  </div>;
}
