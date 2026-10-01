'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, Plus, X } from 'lucide-react';
import { PICKS_PER_RACE, useRaceResults, useRaces, useTeams, type Race, type RaceResult, type Team } from '@/lib/data';
import { closesIn, lineupPoints, pickPoints, type Lineup } from '@/lib/fantasy';
import { hasStarted, nextRace, raceDate, raceTime, useNow } from '@/lib/races';
import { sortStandings } from '@/lib/scoring';
import { shortName } from '@/lib/names';
import { supabase, errorMessage } from '@/lib/supabase';
import { useApp } from './app-shell';
import { useAuth } from './auth';
import { Avatar, Sheet, TeamBadge } from './ui';

type Lineups = Record<string, Lineup>;
type RankingRow = { user_id: string; name: string; avatar_url: string | null; points: number; position: number };
type SaveState = 'idle' | 'saving' | 'saved';
const empty: Lineup = { team_ids: [], double_team_id: null };

const fetchRanking = async () =>
  ((await supabase.rpc('fantasy_ranking', { p_limit: 100 })).data as RankingRow[] | null) ?? [];
// RLS devolve só as escalações da própria pessoa.
const fetchLineups = async (): Promise<Lineups> =>
  Object.fromEntries(((await supabase.from('fantasy_lineups').select('race_id, team_ids, double_team_id')).data ?? [])
    .map(row => [row.race_id, { team_ids: row.team_ids, double_team_id: row.double_team_id }]));

/** Situação de uma prova para quem joga: resultado, fechada ou quanto falta para fechar. */
function raceState(race: Race, now: number, results: RaceResult[]) {
  if (results.some(r => r.race_id === race.id)) return { key: 'scored', label: 'Resultado publicado' };
  if (hasStarted(race, now)) return { key: 'locked', label: 'Fechada' };
  return { key: 'open', label: now ? `Fecha em ${closesIn(Date.parse(race.starts_at) - now)}` : 'Aberta' };
}

export function Fantasy() {
  const { userId, requireLogin } = useAuth();
  const { notify } = useApp();
  const now = useNow();
  const { data: races } = useRaces();
  const { data: teams } = useTeams();
  const results = useRaceResults();
  const [lineups, setLineups] = useState<Lineups>({});
  const [ranking, setRanking] = useState<RankingRow[] | null>(null);
  const [view, setView] = useState<'meu' | 'ranking'>('meu');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [raceList, setRaceList] = useState(false);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poolRef = useRef<HTMLElement>(null);

  const loadRanking = useCallback(() => fetchRanking().then(setRanking), []);
  const loadLineups = useCallback(() => fetchLineups().then(setLineups), []);
  useEffect(() => { void fetchRanking().then(setRanking); }, [userId]);
  useEffect(() => { if (userId) void fetchLineups().then(setLineups); }, [userId]);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const me = ranking?.find(row => row.user_id === userId) ?? null;
  const heading = <div className="page-heading">
    <div><h1>Fantasy</h1>{me && <p>{me.position}º lugar · {me.points} pts</p>}</div>
    <button className="icon-button" onClick={() => setRules(true)} aria-label="Como jogar"><CircleHelp size={20} /></button>
  </div>;

  if (!races || !teams || !results) return <div className="page fantasy">{heading}<Skeleton /></div>;

  const race = races.find(r => r.id === selectedId) ?? nextRace(races, now);
  const lineup = (userId && lineups[race.id]) || empty;
  const locked = hasStarted(race, now);
  const index = races.indexOf(race);
  const state = raceState(race, now, results);
  // Provas seguintes que ainda aceitam escalação: é onde "Repetir" grava (copy_lineup_forward).
  const ahead = races.filter(r => r.number > race.number && !hasStarted(r, now)).length;
  const login = () => requireLogin('Entre para montar seu fantasy e disputar o ranking.');
  const selectRace = (id: string) => { setSelectedId(id); setSaveState('idle'); };

  async function save(next: Lineup) {
    const raceId = race.id, previous = lineup;
    setLineups(current => ({ ...current, [raceId]: next }));
    clearTimeout(savedTimer.current);
    setSaveState('saving');
    const { error } = await supabase.rpc('save_lineup', { p_race_id: raceId, p_team_ids: next.team_ids, p_double: next.double_team_id });
    if (error) { setLineups(current => ({ ...current, [raceId]: previous })); setSaveState('idle'); notify(errorMessage(error)); return; }
    setSaveState('saved');
    savedTimer.current = setTimeout(() => setSaveState('idle'), 2500);
    void loadRanking();
  }

  function toggleTeam(team: Team) {
    if (!userId) { login(); return; }
    if (locked) return;
    if (lineup.team_ids.includes(team.id)) { removeTeam(team.id); return; }
    if (lineup.team_ids.length >= PICKS_PER_RACE) { notify(`Sua escalação já tem ${PICKS_PER_RACE} barcos. Tire um para trocar.`); return; }
    void save({ ...lineup, team_ids: [...lineup.team_ids, team.id] });
  }

  function removeTeam(id: string) {
    void save({ team_ids: lineup.team_ids.filter(t => t !== id), double_team_id: lineup.double_team_id === id ? null : lineup.double_team_id });
  }

  // Tocar no 2x de outro barco move o Turbo direto para ele.
  function toggleTurbo(id: string) {
    if (locked) return;
    void save({ ...lineup, double_team_id: lineup.double_team_id === id ? null : id });
  }

  async function copyForward() {
    setConfirmCopy(false);
    const { error } = await supabase.rpc('copy_lineup_forward', { p_race_id: race.id });
    if (error) { notify(errorMessage(error)); return; }
    await loadLineups();
    notify(`Escalação repetida em ${ahead} ${ahead === 1 ? 'prova' : 'provas'}.`);
  }

  return <div className="page fantasy">
    {heading}

    <div className="fx-tabs" role="tablist" aria-label="Seções do fantasy">
      <button role="tab" aria-selected={view === 'meu'} onClick={() => setView('meu')}>Meu fantasy</button>
      <button role="tab" aria-selected={view === 'ranking'} onClick={() => { setView('ranking'); void loadRanking(); }}>Ranking</button>
    </div>

    {view === 'meu' ? <>
      <div className="fx-round">
        <button className="fx-arrow" disabled={index === 0} onClick={() => selectRace(races[index - 1].id)} aria-label="Prova anterior"><ChevronLeft size={20} /></button>
        <button className="fx-round-title" onClick={() => setRaceList(true)} aria-haspopup="dialog">
          <strong>{race.name}<ChevronDown size={15} /></strong>
          <span>Prova {race.number} · {raceDate(race)}, {raceTime(race)} · <em className={state.key}>{state.label}</em></span>
        </button>
        <button className="fx-arrow" disabled={index === races.length - 1} onClick={() => selectRace(races[index + 1].id)} aria-label="Próxima prova"><ChevronRight size={20} /></button>
      </div>

      <LineupSlots
        race={race} locked={locked} loggedIn={!!userId} lineup={lineup} teams={teams} results={results}
        saveState={saveState} canCopy={ahead > 0}
        onAdd={() => poolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onLogin={login} onRemove={removeTeam} onTurbo={toggleTurbo} onCopy={() => setConfirmCopy(true)} />

      <BoatList ref={poolRef} race={race} teams={teams} results={results} lineup={lineup} locked={locked} onToggle={toggleTeam} />
    </> : <Ranking ranking={ranking} userId={userId} />}

    <Sheet open={raceList} onClose={() => setRaceList(false)} title="Provas">
      <ul className="fx-race-list">
        {races.map(r => {
          const count = userId ? lineups[r.id]?.team_ids.length ?? 0 : 0;
          return <li key={r.id}>
            <button aria-current={r.id === race.id} onClick={() => { selectRace(r.id); setRaceList(false); }}>
              <span className="fx-race-info"><strong>{r.number}. {r.name}</strong><small>{raceDate(r)}, {raceTime(r)} · {raceState(r, now, results).label}</small></span>
              {userId && <span className={`fx-race-count ${count === PICKS_PER_RACE ? 'full' : ''}`}>{count === PICKS_PER_RACE ? <Check size={15} strokeWidth={2.5} /> : `${count}/${PICKS_PER_RACE}`}</span>}
            </button>
          </li>;
        })}
      </ul>
    </Sheet>

    <Sheet open={confirmCopy} onClose={() => setConfirmCopy(false)} title="Repetir escalação">
      <p className="fx-confirm">Os mesmos barcos e o mesmo 2x vão para {ahead === 1 ? 'a próxima prova' : `as próximas ${ahead} provas`}. Escalações que você já fez nelas serão substituídas.</p>
      <div className="fx-confirm-actions">
        <button className="button" onClick={() => setConfirmCopy(false)}>Cancelar</button>
        <button className="button primary" onClick={() => void copyForward()}>Repetir</button>
      </div>
    </Sheet>

    <Sheet open={rules} onClose={() => setRules(false)} title="Como jogar">
      <ol className="fx-rules">
        <li><strong>Escolha {PICKS_PER_RACE} barcos por prova</strong><p>São {races.length} provas, e a escalação é separada para cada uma. Tudo é salvo na hora.</p></li>
        <li><strong>Ligue o Turbo solar</strong><p>Toque no 2x de um dos seus barcos: ele vale o dobro dos pontos na prova.</p></li>
        <li><strong>Troque até a largada</strong><p>Dá para mudar os barcos e o Turbo até o horário de início da prova. Depois disso, trava.</p></li>
        <li><strong>Suba no ranking</strong><p>Quando a organização publica o resultado, os pontos dos seus barcos entram na sua soma.</p></li>
      </ol>
      <p className="footnote">Fantasy gratuito, sem apostas ou prêmios em dinheiro.</p>
    </Sheet>
  </div>;
}

/** As 3 vagas: logo, nome e o 2x embaixo. Uma linha central explica o que fazer a seguir. */
function LineupSlots({ race, locked, loggedIn, lineup, teams, results, saveState, canCopy, onAdd, onLogin, onRemove, onTurbo, onCopy }: {
  race: Race; locked: boolean; loggedIn: boolean; lineup: Lineup; teams: Team[]; results: RaceResult[]; saveState: SaveState; canCopy: boolean;
  onAdd: () => void; onLogin: () => void; onRemove: (id: string) => void; onTurbo: (id: string) => void; onCopy: () => void;
}) {
  const scored = results.some(r => r.race_id === race.id);
  const count = lineup.team_ids.length;
  const slots = Array.from({ length: PICKS_PER_RACE }, (_, i) => lineup.team_ids[i] ?? null);
  const turboTeam = teams.find(t => t.id === lineup.double_team_id);

  let note: React.ReactNode;
  if (scored) note = <>Você fez <strong>{lineupPoints(lineup, results, race.id)} pts</strong> nesta prova</>;
  else if (locked) note = count ? 'Escalação fechada. Agora é torcer.' : 'Você não escalou nesta prova.';
  else if (!loggedIn || !count) note = `Escolha ${PICKS_PER_RACE} barcos para esta prova`;
  else if (turboTeam) note = <><strong>{turboTeam.name}</strong> vale o dobro nesta prova</>;
  else note = 'Toque em 2x para dobrar os pontos de um barco';

  return <section className="fx-lineup" aria-label="Sua escalação">
    <div className="fx-slots">
      {slots.map((id, i) => {
        const team = id ? teams.find(t => t.id === id) : undefined;
        if (!id || !team) {
          const content = <><span className="fx-slot-logo empty"><Plus size={22} /></span><span className="fx-slot-name">Barco {i + 1}</span></>;
          return locked || !loggedIn
            ? <div key={`empty-${i}`} className="fx-slot">{content}</div>
            : <button key={`empty-${i}`} className="fx-slot" onClick={onAdd} aria-label="Escolher barco">{content}</button>;
        }
        const turbo = lineup.double_team_id === id;
        return <div key={id} className={`fx-slot filled ${turbo ? 'turbo' : ''}`}>
          <span className="fx-slot-logo">
            <TeamBadge team={team} />
            {!locked && <button className="fx-slot-remove" onClick={() => onRemove(id)} aria-label={`Tirar ${team.name}`}><X size={11} strokeWidth={2.5} /></button>}
          </span>
          <span className="fx-slot-name">{team.name}</span>
          {scored ? <span className="fx-slot-points">{pickPoints(lineup, results, race.id, id) ?? 0} pts{turbo && ' · 2x'}</span>
            : locked ? turbo && <span className="fx-x2 on">2x</span>
            : <button className={`fx-x2 ${turbo ? 'on' : ''}`} onClick={() => onTurbo(id)} aria-pressed={turbo}
              aria-label={`${turbo ? 'Desligar' : 'Ligar'} o Turbo solar em ${team.name}`}>2x</button>}
        </div>;
      })}
    </div>

    <p className="fx-note">{note}</p>

    {!loggedIn ? <button className="button primary fx-login" onClick={onLogin}>Entrar para escalar</button>
      : !locked && <div className="fx-lineup-foot">
        <span className={`fx-save ${saveState}`} aria-live="polite">
          {saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? <><Check size={13} strokeWidth={2.5} /> Salvo</> : `${count} de ${PICKS_PER_RACE} barcos`}
        </span>
        {count > 0 && canCopy && <button className="fx-link" onClick={onCopy}><Copy size={13} /> Repetir nas próximas</button>}
      </div>}
  </section>;
}

/** Linha de apoio de cada barco: campanha na geral depois que a etapa começa, ou a universidade. */
function boatDetails(teams: Team[]) {
  const started = teams.some(t => t.points !== 0);
  return new Map(sortStandings(teams).map((t, i) => [t.id, started ? `${i + 1}º na geral · ${t.points} pts` : t.university]));
}

function BoatRow({ team, lineup, detail, points, locked, onToggle }: {
  team: Team; lineup: Lineup; detail?: string; points?: number; locked: boolean; onToggle: () => void;
}) {
  const picked = lineup.team_ids.includes(team.id);
  return <li>
    <button className={`fx-boat ${picked ? 'picked' : ''}`} disabled={locked}
      onClick={onToggle} aria-pressed={picked} aria-label={`${picked ? 'Tirar' : 'Escolher'} ${team.name}`}>
      <TeamBadge team={team} small />
      <span className="fx-boat-name">
        <strong>{team.name}{lineup.double_team_id === team.id && <span className="fx-x2 on mini">2x</span>}</strong>
        {detail && <small>{detail}</small>}
      </span>
      {points !== undefined && <span className="fx-boat-points">{points}</span>}
      {!locked && <span className="fx-tick" aria-hidden="true">{picked && <Check size={12} strokeWidth={3} />}</span>}
    </button>
  </li>;
}

function BoatList({ ref, race, teams, results, lineup, locked, onToggle }: {
  ref: React.Ref<HTMLElement>; race: Race; teams: Team[]; results: RaceResult[]; lineup: Lineup; locked: boolean; onToggle: (team: Team) => void;
}) {
  const raceResults = new Map(results.filter(r => r.race_id === race.id).map(r => [r.team_id, r.points]));
  const scored = raceResults.size > 0;
  const full = lineup.team_ids.length >= PICKS_PER_RACE;
  const list = scored ? [...teams].sort((a, b) => (raceResults.get(b.id) ?? -1) - (raceResults.get(a.id) ?? -1)) : teams;
  const details = boatDetails(teams);
  const picked = lineup.team_ids.map(id => teams.find(t => t.id === id)).filter(t => t !== undefined);

  return <section ref={ref} className="fx-pool" aria-label="Barcos">
    {/* Fica preso no topo ao rolar, para a escalação não sumir da vista. */}
    <div className="fx-pool-head">
      <h2 className="fx-label">{scored ? 'Pontos na prova' : 'Barcos'}</h2>
      {!scored && <span className="fx-picked" aria-label={`${picked.length} de ${PICKS_PER_RACE} escolhidos`}>
        {picked.map(team => <TeamBadge key={team.id} team={team} small />)}
        <span>{picked.length}/{PICKS_PER_RACE}</span>
      </span>}
    </div>
    <ul className={`fx-boats ${full && !locked ? 'full' : ''}`}>
      {list.map(team => <BoatRow key={team.id} team={team} lineup={lineup} detail={details.get(team.id)}
        points={raceResults.get(team.id)} locked={locked} onToggle={() => onToggle(team)} />)}
    </ul>
  </section>;
}

function Ranking({ ranking, userId }: { ranking: RankingRow[] | null; userId: string | null }) {
  if (ranking === null) return <Skeleton rows />;
  if (ranking.length === 0) return <p className="fx-empty">Ninguém escalou ainda. Monte seu fantasy e abra o ranking.</p>;
  return <section aria-label="Ranking geral">
    <ol className="fx-list">
      {ranking.map(player => <li key={player.user_id} className={player.user_id === userId ? 'you' : ''}>
        <span className={`fx-pos ${player.position <= 3 ? `p${player.position}` : ''}`}>{player.position}</span>
        <Avatar id={player.user_id} name={player.name} url={player.avatar_url} small />
        <span className="fx-list-name">{shortName(player.name)}{player.user_id === userId && <small> · você</small>}</span>
        <strong>{player.points}<small> pts</small></strong>
      </li>)}
    </ol>
    <p className="footnote">{ranking.length} {ranking.length === 1 ? 'participante' : 'participantes'}. Pontos com o Turbo solar já contado em dobro.</p>
  </section>;
}

/** Esqueleto no formato da tela enquanto provas e barcos carregam. */
function Skeleton({ rows = false }: { rows?: boolean }) {
  return <div className="fx-skeleton" aria-label="Carregando" role="status">
    {!rows && <><span className="fx-sk-title" /><div className="fx-slots">{[0, 1, 2].map(i => <span key={i} className="fx-sk-slot" />)}</div></>}
    {[0, 1, 2, 3, 4].map(i => <span key={i} className="fx-sk-row" />)}
  </div>;
}
