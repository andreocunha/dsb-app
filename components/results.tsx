'use client';
import { useState } from 'react';
import { ChevronDown, Clock3, Share2, Trophy } from 'lucide-react';
import { useRaces, type Race, type Team } from '@/lib/data';
import { useRaceLaps, useResults, type ResultsData } from '@/lib/results';
import { hasStarted, raceDate, raceTime, useNow } from '@/lib/races';
import {
  DOC_ITEMS, ITEM_POINTS, bracketColumns, closingWindowMinutes, duelWinner, formatDuel, formatDuration,
  lapSplits, pointsIntensity, sortRace, sortStandings, stageLabel, type Duel, type Score,
} from '@/lib/scoring';
import { Sheet, TeamBadge } from './ui';
import { ShareArt } from './share-art';

const int = (n: number) => n.toLocaleString('pt-BR');
const minus = (n: number) => `−${int(Math.abs(n))}`;
const extrasOf = (team: Team) => team.docs_delivered * ITEM_POINTS + (team.article_delivered ? ITEM_POINTS : 0);
const scoreKey = (raceId: string, teamId: string) => `${raceId}:${teamId}`;

/**
 * Resultados do botão "Resultado" da home: bottom sheet no celular, modal grande no desktop.
 * Um seletor troca entre a classificação geral e cada prova.
 */
export function ResultsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: races } = useRaces();
  const { data, error } = useResults(open);
  const [raceId, setRaceId] = useState('');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const race = races?.find(r => r.id === raceId) ?? null;
  const standings = data ? sortStandings(data.teams) : [];
  const selected = standings.find(t => t.id === teamId) ?? null;
  const scoredRaces = data ? new Set(data.scores.map(s => s.race_id)).size : 0;
  const ready = !!(races && data);

  return <Sheet open={open} onClose={onClose} size="large" title="Resultados"
    subtitle={races ? `Etapa Macaé 2026 · ${scoredRaces} de ${races.length} provas com resultado` : 'Etapa Macaé 2026'}
    actions={ready && <button className="button share-button" onClick={() => setSharing(true)} aria-label="Compartilhar resultado como imagem">
      <Share2 size={16} /><span>Compartilhar</span>
    </button>}>
    {!ready ? <p className="panel-note">{error ? 'Não foi possível carregar os resultados. Confira sua conexão.' : 'Carregando…'}</p> : <>
      <div className="results-toolbar">
        <label className="view-select">
          <span className="sr-only">Mostrar</span>
          <select value={race?.id ?? ''} onChange={e => setRaceId(e.target.value)}>
            <option value="">Classificação geral</option>
            {races.map(r => <option key={r.id} value={r.id}>Prova {r.number} · {r.name}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </label>
      </div>
      {!race ? <Standings races={races} data={data} standings={standings} onTeam={setTeamId} />
        : race.kind === 'bracket' ? <MatchRace key={race.id} race={race} data={data} />
        : <LapRace key={race.id} race={race} data={data} />}
      <TeamSheet team={selected} standings={standings} races={races} data={data} onClose={() => setTeamId(null)} />
      <ShareArt open={sharing} onClose={() => setSharing(false)} race={race} data={data} />
    </>}
  </Sheet>;
}

function Standings({ races, data, standings, onTeam }: { races: Race[]; data: ResultsData; standings: Team[]; onTeam: (id: string) => void }) {
  const scores = new Map(data.scores.map(s => [scoreKey(s.race_id, s.team_id), s]));
  const started = standings.some(team => team.points !== 0);

  return <div className="standings-layout">
    <div className="standings-side">
    {!started && <p className="results-note"><Trophy size={16} /> {standings.length} equipes inscritas. A pontuação começa na primeira prova.</p>}
    {started && <div className="podium" aria-label="Pódio">
      {[1, 0, 2].map(i => standings[i] && <button key={standings[i].id} className={`podium-place p${i + 1}`} onClick={() => onTeam(standings[i].id)}>
        <TeamBadge team={standings[i]} />
        <strong>{standings[i].name}</strong>
        <small>{int(standings[i].points)} pts</small>
        <span className="podium-block">{i + 1}º</span>
      </button>)}
    </div>}
    <Legend />
    </div>

    <section className="card standings" aria-label="Classificação geral">
      <div className="standings-head" aria-hidden="true">
        <span className="score-cells">{races.map(r => <span key={r.id}>{r.number}</span>)}</span>
        <span>Total</span>
      </div>
      <ol>
        {standings.map((team, index) => <li key={team.id}>
          <button className="standings-row" onClick={() => onTeam(team.id)}>
            <span className="position">{started ? index + 1 : ''}</span>
            <TeamBadge team={team} small />
            <span className="standings-main">
              <span className="standings-name">
                <strong>{team.name}</strong>
                {team.penalty_points < 0 && <span className="penalty-tag"><span className="sr-only">Penalidade </span>{minus(team.penalty_points)}</span>}
              </span>
              <span className="score-cells">{races.map(r => <ScoreCell key={r.id} race={r} score={scores.get(scoreKey(r.id, team.id))} />)}</span>
            </span>
            <span className="standings-total">
              <strong>{int(team.points)}</strong>
              {extrasOf(team) > 0 && <small>+{extrasOf(team)} extras</small>}
            </span>
          </button>
        </li>)}
      </ol>
    </section>
  </div>;
}

function Legend() {
  return <div className="results-legend">
    <span><span className="swatch strong" /> 150 pts</span>
    <span><span className="swatch" /> 50 pts</span>
    <span><span className="score-cell dnf">DNF</span> largou e não terminou · 20 pts</span>
    <span><span className="score-cell dns">DNS</span> não largou · 0 pts</span>
    <span>Extras: documentação pré-evento e artigo científico, 20 pts por item.</span>
  </div>;
}

function ScoreCell({ race, score }: { race: Race; score?: Score }) {
  const label = <span className="sr-only">Prova {race.number}: </span>;
  if (!score) return <span className="score-cell empty">{label}–</span>;
  if (score.status !== 'ok') return <span className={`score-cell ${score.status}`}>{label}{score.status.toUpperCase()}</span>;
  const t = pointsIntensity(score.points);
  return <span className={`score-cell ${t > .5 ? 'strong' : ''}`} style={{ '--t': t } as React.CSSProperties}>{label}{score.points}</span>;
}

function PositionBadge({ score }: { score: Score }) {
  const text = score.position ? `${score.position}º` : score.status === 'ok' ? '–' : score.status.toUpperCase();
  const tone = score.status !== 'ok' ? score.status : score.position && score.position <= 3 ? `p${score.position}` : '';
  return <span className={`position-badge ${tone}`}>{text}</span>;
}

const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Topo de cada prova, como na prévia: prova e data, nome grande e como ela é decidida. */
function RaceHeader({ race }: { race: Race }) {
  const minutes = race.duration_minutes;
  const rule = race.kind === 'bracket'
    ? 'Duelos X1 eliminatórios: passa quem fizer o menor tempo. Quem cai na mesma fase é ordenado pelo tempo.'
    : minutes
      ? `${minutes} min de prova, com até ${Math.round(closingWindowMinutes(minutes))} min para fechar a última volta. Vence quem completar mais voltas.`
      : 'Vence quem completar mais voltas; no empate, quem fechou a última volta primeiro.';
  return <header className="race-header">
    <span>Prova {race.number} · {dayMonth.format(new Date(race.starts_at))} · {raceTime(race)}</span>
    <h3>{race.name}</h3>
    <p>{rule}</p>
  </header>;
}

/** Aviso de prova ainda sem resultado, com a largada. */
function StartNotice({ race }: { race: Race }) {
  const now = useNow();
  const when = `${raceDate(race).toLowerCase()}, às ${raceTime(race)}`;
  return <p className="results-note"><Clock3 size={16} /> {hasStarted(race, now)
    ? `A prova largou ${when}. O resultado aparece aqui assim que sair.`
    : `A prova ainda não começou. Largada ${when}.`}</p>;
}

/** Antes do resultado, as equipes inscritas ocupam as linhas da prova, em ordem alfabética. */
const waitingRows = (race: Race, teams: Team[]): Score[] =>
  [...teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map(team => ({
    race_id: race.id, team_id: team.id, status: 'ok', note: '', laps: 0, last_lap_at: null,
    stage: null, duel_time: null, position: null, points: 0,
  }));

function formatTick(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}min`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;
}

function LapRace({ race, data }: { race: Race; data: ResultsData }) {
  const laps = useRaceLaps(race.id);
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const published = sortRace(data.scores.filter(s => s.race_id === race.id));
  const pending = !published.length;
  const scores = pending ? waitingRows(race, data.teams) : published;

  const teams = new Map(data.teams.map(t => [t.id, t]));
  const start = Date.parse(race.started_at ?? race.starts_at);
  const duration = race.duration_minutes ? race.duration_minutes * 60_000 : null;
  const deadline = race.duration_minutes ? start + duration! + closingWindowMinutes(race.duration_minutes) * 60_000 : null;
  const live = deadline !== null && now >= start && now < deadline;
  const timesOf = (teamId: string) => laps?.get(teamId) ?? [];
  const splits = new Map(scores.map(s => [s.team_id, lapSplits(timesOf(s.team_id), start)]));
  const bests = scores.flatMap(s => { const list = splits.get(s.team_id)!; return list.length ? [{ team: s.team_id, ms: Math.min(...list) }] : []; });
  const best = bests.sort((a, b) => a.ms - b.ms)[0];
  const leader = !pending && scores[0]?.status === 'ok' ? scores[0] : null;
  const leaderLast = leader?.last_lap_at ? Date.parse(leader.last_lap_at) : null;

  const lastTime = Math.max(start + (duration ?? 0), ...scores.map(s => s.last_lap_at ? Date.parse(s.last_lap_at) : start));
  const span = Math.max(lastTime - start, 60_000) * 1.04;
  const x = (time: number) => `${((time - start) / span * 100).toFixed(2)}%`;
  // Marcações em minutos redondos: no máximo 5 ao longo do gráfico.
  const step = ([5, 10, 15, 20, 30, 60, 120].find(m => span / 60_000 / m <= 5) ?? 240) * 60_000;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);

  function detail(score: Score) {
    if (pending) return 'Aguardando a largada';
    if (score.status === 'dns') return 'Não largou';
    const voltas = `${score.laps} ${score.laps === 1 ? 'volta' : 'voltas'}`;
    if (score.status === 'dnf') return `Não terminou · ${voltas}`;
    const last = score.last_lap_at ? Date.parse(score.last_lap_at) : null;
    let text = last ? `${voltas} · ${formatDuration(last - start)}` : voltas;
    if (leader && score !== leader && leaderLast && last) {
      const behind = leader.laps - score.laps;
      text += behind > 0 ? ` · −${behind} ${behind === 1 ? 'volta' : 'voltas'}` : ` · +${formatDuration(last - leaderLast)}`;
    }
    return text;
  }

  return <>
    <RaceHeader race={race} />
    {pending && <StartNotice race={race} />}
    <div className="lap-layout">
    <div className="lap-side">
    <div className="race-summary">
      <div><span>{live ? 'Liderando' : 'Vencedor'}</span><strong>{leader ? `${leader.laps} voltas` : '–'}</strong><small>{leader ? teams.get(leader.team_id)?.name : 'a definir'}</small></div>
      <div><span>Melhor volta</span><strong>{best ? formatDuration(best.ms) : '–'}</strong><small>{best ? teams.get(best.team)?.name : 'a definir'}</small></div>
      {pending
        ? <div><span>Inscritas</span><strong>{scores.length}</strong><small>equipes</small></div>
        : <div><span>Terminaram</span><strong>{scores.filter(s => s.status === 'ok').length}/{scores.length}</strong><small>{scores.filter(s => s.status === 'dnf').length} DNF · {scores.filter(s => s.status === 'dns').length} DNS</small></div>}
    </div>
    {live && <p className="live-note"><span className="live-dot" /> Parcial: a prova ainda está acontecendo.</p>}

    {(pending || (laps && laps.size > 0)) && <section className="card lap-chart" aria-label="Voltas ao longo da prova">
      <div className="lap-chart-title"><h2>Voltas ao longo da prova</h2><small>cada ponto é uma volta</small></div>
      <div className={`lap-lanes ${pending ? 'empty' : ''}`}>
        {pending && <p className="lap-empty">As voltas aparecem aqui durante a prova, no horário em que cada barco fechar a volta.</p>}
        {duration && <div className="lap-overlay" aria-hidden="true"><span className="lap-flag" style={{ left: x(start + duration) }} /></div>}
        {scores.filter(s => s.status !== 'dns').map(s => {
          const times = timesOf(s.team_id);
          const list = splits.get(s.team_id)!;
          const bestIndex = list.indexOf(Math.min(...list));
          const end = times.length ? times[times.length - 1] : start;
          const team = teams.get(s.team_id);
          return <div key={s.team_id} className="lap-lane">
            {team && <span className="lap-logo"><TeamBadge team={team} small /></span>}
            <span className="lap-track">
              <span className="lap-line" style={{ width: x(end) }} />
              {times.map((time, i) => <span key={time} className={`lap-dot ${i === bestIndex ? 'best' : ''}`} style={{ left: x(time) }} />)}
              {s.status === 'dnf' && <span className="lap-dnf" style={{ left: x(end) }}>×</span>}
            </span>
          </div>;
        })}
      </div>
      {(!pending || duration) && <div className="lap-ticks" aria-hidden="true">{ticks.map(ms => <span key={ms} style={{ left: x(start + ms) }}>{ms ? formatTick(ms) : '0'}</span>)}</div>}
      <div className="results-legend">
        <span><span className="lap-dot static" /> volta</span>
        <span><span className="lap-dot static best" /> melhor volta da equipe</span>
        {duration && <span><span className="lap-flag static" /> fim do tempo de prova</span>}
        <span><span className="lap-dnf static">×</span> abandono (DNF)</span>
      </div>
    </section>}
    </div>

    <div className="lap-main">
    <section className="card race-results" aria-label={`Resultado da ${race.name}`}>
      <ol>
        {scores.map(score => {
          const team = teams.get(score.team_id);
          const list = splits.get(score.team_id)!;
          const isOpen = open === score.team_id;
          const bestSplit = Math.min(...list);
          return <li key={score.team_id}>
            <button className="race-row" onClick={() => setOpen(isOpen ? null : score.team_id)} aria-expanded={isOpen} disabled={!list.length}>
              <PositionBadge score={score} />
              {team && <TeamBadge team={team} small />}
              <span className="race-row-main"><strong>{team?.name ?? score.team_id}</strong><small>{detail(score)}{score.note && ` · ${score.note}`}</small></span>
              <span className="race-row-points"><strong>{pending ? '–' : score.points}</strong><small>pts</small></span>
              {list.length > 0 && <ChevronDown size={16} className="race-row-chevron" />}
            </button>
            {isOpen && <div className="lap-splits">
              {list.map((ms, i) => <span key={i} className={ms === bestSplit ? 'best' : ''}><small>V{i + 1}</small> {formatDuration(ms)}</span>)}
            </div>}
          </li>;
        })}
      </ol>
    </section>
    </div>
  </div>
  </>;
}

// Chave do Match Race desenhada em px: cada coluna é uma fase e o duelo seguinte
// fica na altura do meio dos dois que o alimentam.
const CARD_W = 176, CARD_H = 64, GAP_X = 36, SLOT = 80, HEAD = 28;

function MatchRace({ race, data }: { race: Race; data: ResultsData }) {
  const duels = data.duels.filter(d => d.race_id === race.id);
  const published = sortRace(data.scores.filter(s => s.race_id === race.id));
  const pending = !published.length;
  const scores = pending ? waitingRows(race, data.teams) : published;

  const teams = new Map(data.teams.map(t => [t.id, t]));
  const columns = bracketColumns(duels, data.teams.length);
  const third = duels.find(d => d.stage === 'third');
  const final = duels.find(d => d.stage === 'final');
  const finalWinner = final ? duelWinner(final) : null;

  const rows = columns[0]?.duels.length ?? 0;
  const colX = (c: number) => c * (CARD_W + GAP_X);
  const centerY = (c: number, k: number) => { const span = 2 ** c; return HEAD + SLOT * (span * k + (span - 1) / 2) + SLOT / 2; };
  const finalCol = columns.length - 1;
  const thirdY = columns.length ? centerY(finalCol, 0) + CARD_H + 56 : 0;
  const width = colX(finalCol) + CARD_W;
  const height = Math.max(HEAD + SLOT * rows, third ? thirdY + CARD_H / 2 + 4 : 0);

  const lines: React.CSSProperties[] = [];
  columns.slice(0, -1).forEach((column, c) => {
    for (let k = 0; k < column.duels.length; k += 2) {
      const x1 = colX(c) + CARD_W, half = GAP_X / 2;
      const ya = centerY(c, k), yb = centerY(c, k + 1), yn = centerY(c + 1, k / 2);
      lines.push({ left: x1, top: ya, width: half, height: 1.5 }, { left: x1, top: yb, width: half, height: 1.5 },
        { left: x1 + half, top: ya, width: 1.5, height: yb - ya + 1.5 }, { left: x1 + half, top: yn, width: half, height: 1.5 });
    }
  });

  return <>
    <RaceHeader race={race} />
    {pending && <StartNotice race={race} />}
    <div className="match-layout">
    {final && finalWinner && <section className="final-card" aria-label="Final">
      <div className="final-card-title"><h2>Final</h2>{final.time_a !== null && final.time_b !== null && <small>diferença {Math.abs(final.time_a - final.time_b).toFixed(1).replace('.', ',')}s</small>}</div>
      {(finalWinner === 'a' ? ['a', 'b'] as const : ['b', 'a'] as const).map((side, i) => {
        const team = teams.get((side === 'a' ? final.team_a : final.team_b) ?? '');
        const time = side === 'a' ? final.time_a : final.time_b;
        return team && <div key={side} className={`final-side ${i === 0 ? 'champion' : ''}`}>
          <TeamBadge team={team} />
          <span><strong>{team.name}</strong><small>{i === 0 ? 'Campeão da prova · 150 pts' : 'Vice · 140 pts'}</small></span>
          {time !== null && <strong className="final-time">{formatDuel(time)}</strong>}
        </div>;
      })}
    </section>}

    {columns.length > 0 && <section className="bracket-section" aria-label="Chaveamento">
      <div className="bracket-title"><h2>Chaveamento</h2>{columns.length > 2 && <small className="bracket-hint">arraste para o lado →</small>}</div>
      <div className="bracket-scroll">
        <div className="bracket" style={{ width, height }}>
          {columns.map((column, c) => <span key={column.stage} className="bracket-head" style={{ left: colX(c), width: CARD_W }}>{column.stage === 'final' ? 'Final' : stageLabel[column.stage]}</span>)}
          {third && <span className="bracket-head" style={{ left: colX(finalCol), top: thirdY - CARD_H / 2 - 22, width: CARD_W }}>Disputa de 3º</span>}
          {lines.map((style, i) => <span key={i} className="bracket-line" style={style} />)}
          {columns.map((column, c) => column.duels.map((duel, k) =>
            <DuelCard key={`${column.stage}-${k}`} duel={duel} teams={teams} champion={column.stage === 'final'} style={{ left: colX(c), top: centerY(c, k) - CARD_H / 2, width: CARD_W, height: CARD_H }} />))}
          {third && <DuelCard duel={third} teams={teams} style={{ left: colX(finalCol), top: thirdY - CARD_H / 2, width: CARD_W, height: CARD_H }} />}
        </div>
      </div>
    </section>}

    {scores.length > 0 && <section className={`card race-results match-ranking ${final && finalWinner ? '' : 'wide'}`} aria-label="Classificação da prova">
      <h2 className="card-subtitle">{pending ? `${scores.length} equipes inscritas` : 'Classificação da prova'}</h2>
      <ol>
        {scores.map(score => {
          const team = teams.get(score.team_id);
          const stage = pending ? 'Aguardando o chaveamento' : score.stage ? stageLabel[score.stage] : score.status === 'dns' ? 'Não largou' : score.status === 'dnf' ? 'Não terminou' : 'Chave em andamento';
          return <li key={score.team_id}>
            <div className="race-row">
              <PositionBadge score={score} />
              {team && <TeamBadge team={team} small />}
              <span className="race-row-main"><strong>{team?.name ?? score.team_id}</strong><small>{stage}{score.duel_time !== null && score.position && score.position > 4 ? ` · ${formatDuel(score.duel_time)} no X1` : ''}{score.note && ` · ${score.note}`}</small></span>
              <span className="race-row-points"><strong>{pending ? '–' : score.points}</strong><small>pts</small></span>
            </div>
          </li>;
        })}
      </ol>
    </section>}
  </div>
  </>;
}

function DuelCard({ duel, teams, champion = false, style }: { duel: Duel | null; teams: Map<string, Team>; champion?: boolean; style: React.CSSProperties }) {
  const winner = duel ? duelWinner(duel) : null;
  const decided = duel && winner && duel.team_a && duel.team_b;
  const side = (key: 'a' | 'b') => {
    const id = duel?.[key === 'a' ? 'team_a' : 'team_b'];
    const time = duel?.[key === 'a' ? 'time_a' : 'time_b'] ?? null;
    const team = id ? teams.get(id) : undefined;
    const state = !decided ? '' : winner === key ? (champion ? 'win champion' : 'win') : 'lose';
    return <span className={`duel-side ${state}`}>
      {team ? <TeamBadge team={team} small /> : <span className="duel-empty" />}
      <span className="duel-name">{team?.name ?? (duel && duel.team_a && !duel.team_b ? 'Passa direto' : 'A definir')}</span>
      {time !== null && <span className="duel-time">{formatDuel(time)}</span>}
    </span>;
  };
  return <div className={`duel-card ${champion && decided ? 'champion' : ''}`} style={style}>{side('a')}{side('b')}</div>;
}

function TeamSheet({ team: current, standings, races, data, onClose }: { team: Team | null; standings: Team[]; races: Race[]; data: ResultsData; onClose: () => void }) {
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const team = current ?? last;
  const position = team ? standings.findIndex(t => t.id === team.id) + 1 : 0;
  const scores = new Map(data.scores.map(s => [scoreKey(s.race_id, s.team_id), s]));
  const penalties = team ? data.penalties.filter(p => p.team_id === team.id) : [];
  const positive = team ? Math.max(team.race_points + extrasOf(team), 1) : 1;
  return <Sheet open={!!current} onClose={onClose} title={team?.name ?? 'Equipe'}>
    {team && <div className="team-detail">
      <div className="team-summary">
        <TeamBadge team={team} />
        <div><strong>{position}º lugar</strong><span>{int(team.points)} pts</span></div>
      </div>

      <section>
        <h3>De onde vêm os pontos</h3>
        <div className="points-bar" aria-hidden="true">
          <span className="races" style={{ width: `${team.race_points / positive * 100}%` }} />
          <span className="extras" style={{ width: `${extrasOf(team) / positive * 100}%` }} />
        </div>
        <ul className="points-breakdown">
          <li><span className="swatch strong" />Provas<strong>{int(team.race_points)}</strong></li>
          <li><span className="swatch extras" />Documentação pré-evento · {team.docs_delivered} de {DOC_ITEMS} itens<strong>+{team.docs_delivered * ITEM_POINTS}</strong></li>
          <li><span className="swatch extras" />Artigo científico · {team.article_delivered ? 'entregue' : 'não entregue'}<strong>+{team.article_delivered ? ITEM_POINTS : 0}</strong></li>
          {penalties.map(p => <li key={p.id} className="penalty"><span className="swatch penalty" />{p.reason} · {new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}<strong>{minus(p.points)}</strong></li>)}
          <li className="total">Total<strong>{int(team.points)}</strong></li>
        </ul>
      </section>

      <section>
        <h3>Prova a prova</h3>
        <ol className="team-races">
          {races.map(race => {
            const score = scores.get(scoreKey(race.id, team.id));
            const detail = !score ? 'Sem resultado ainda'
              : score.status === 'dns' ? 'Não largou'
              : score.status === 'dnf' ? `Não terminou · ${score.laps} ${score.laps === 1 ? 'volta' : 'voltas'}`
              : race.kind === 'bracket' ? (score.stage ? stageLabel[score.stage] : 'Chave em andamento')
              : `${score.laps} voltas`;
            return <li key={race.id}>
              <span className="chip-number">{race.number}</span>
              <span className="race-row-main"><strong>{race.name}</strong><small>{detail}</small></span>
              {score && <PositionBadge score={score} />}
              <strong className="team-race-points">{score ? score.points : '–'}</strong>
            </li>;
          })}
        </ol>
      </section>
    </div>}
  </Sheet>;
}
