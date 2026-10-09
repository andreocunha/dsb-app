'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Share2, Trophy } from 'lucide-react';
import { useRaces, type Race, type Team } from '@/lib/data';
import { useRaceLaps, useResults, type ResultsData } from '@/lib/results';
import { closingMinutes, nextRace, useNow } from '@/lib/races';
import { clock, dayLabel, hhmm, itemFromRace, phaseOf, startsIn, LATE_AFTER } from '@/lib/schedule';
import { useClock } from '@/lib/use-schedule';
import {
  DOC_ITEMS, ITEM_POINTS, bracketColumns, duelWinner, formatDuel, formatDuration,
  lapSplits, pointsIntensity, sortRace, sortStandings, stageLabel, type Duel, type Score,
} from '@/lib/scoring';
import { Sheet, TeamBadge } from './ui';
import { ShareArt } from './share-art';
import { Tag } from './schedule';

const int = (n: number) => n.toLocaleString('pt-BR');
const minus = (n: number) => `−${int(Math.abs(n))}`;
const extrasOf = (team: Team) => team.docs_delivered * ITEM_POINTS + (team.article_delivered ? ITEM_POINTS : 0);
const scoreKey = (raceId: string, teamId: string) => `${raceId}:${teamId}`;

/** Prova acontecendo agora (ou fechando a última volta), para abrir direto nela. */
const isLive = (race: Race, now: number) => { const kind = phaseOf(itemFromRace(race), now).kind; return kind === 'live' || kind === 'closing'; };

/**
 * Resultados do botão "Resultado" da home: bottom sheet no celular, modal grande no desktop.
 * Abas no topo trocam entre a classificação geral e cada prova; abre na prova que estiver acontecendo.
 */
export function ResultsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: races } = useRaces();
  const { data, error } = useResults(open);
  const now = useNow();
  // null: ainda não escolheu, vale a prova ao vivo (ou a geral).
  const [raceId, setRaceId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);

  const liveRace = races && now ? races.find(r => isLive(r, now)) ?? null : null;
  const chosen = raceId ?? liveRace?.id ?? '';
  const race = races?.find(r => r.id === chosen) ?? null;
  const standings = useMemo(() => (data ? sortStandings(data.teams) : []), [data]);
  const selected = standings.find(t => t.id === teamId) ?? null;
  const scoredRaces = data ? new Set(data.scores.map(s => s.race_id)).size : 0;
  const ready = !!(races && data);

  // A lista pesada não entra no meio da subida do sheet (trava em celular simples): se os dados
  // chegam durante a animação, esperam ela acabar. Já prontos no toque, entram junto com o sheet.
  const [settled, setSettled] = useState(false);
  const [readyAtOpen, setReadyAtOpen] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setReadyAtOpen(ready); setSettled(false); }
  }
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setSettled(true), 340);
    return () => clearTimeout(timer);
  }, [open]);
  const show = ready && (readyAtOpen || settled);

  // A aba escolhida fica sempre à vista na faixa rolável.
  useEffect(() => {
    tabs.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [chosen, ready]);

  return <Sheet open={open} onClose={onClose} size="large" title="Resultados"
    subtitle={races ? `Macaé 2026 · ${scoredRaces} de ${races.length} provas apuradas` : 'Macaé 2026'}
    actions={ready && <button className="icon-button" onClick={() => setSharing(true)} aria-label="Compartilhar como imagem" title="Compartilhar como imagem">
      <Share2 size={19} />
    </button>}>
    {!show ? <p className="panel-note">{error ? 'Não foi possível carregar os resultados. Confira sua conexão.' : 'Carregando…'}</p> : <>
      <div className="results-toolbar">
        <div className="results-tabs" ref={tabs} role="group" aria-label="Classificação">
          <button aria-pressed={!race} onClick={() => setRaceId('')}>Geral</button>
          {races.map(r => <button key={r.id} aria-pressed={race?.id === r.id} onClick={() => setRaceId(r.id)}>
            <span className="results-tab-number">{r.number}</span>{r.name}
            {now > 0 && isLive(r, now) && <span className="live-dot" aria-label="acontecendo agora" />}
          </button>)}
        </div>
      </div>
      {!race ? <Standings races={races} data={data} standings={standings} onTeam={setTeamId} />
        : race.kind === 'bracket' ? <MatchRace key={race.id} race={race} data={data} onTeam={setTeamId} />
        : <LapRace key={race.id} race={race} data={data} onTeam={setTeamId} />}
      <TeamSheet team={selected} standings={standings} races={races} data={data} onClose={() => setTeamId(null)} />
      <ShareArt open={sharing} onClose={() => setSharing(false)} race={race} data={data} />
    </>}
  </Sheet>;
}

/** Antes de haver pontos: as equipes inscritas, em grade compacta. */
function Entrants({ teams, onTeam }: { teams: Team[]; onTeam: (id: string) => void }) {
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return <section className="entrants" aria-label="Equipes inscritas">
    <h2 className="entrants-title">{sorted.length} equipes inscritas</h2>
    <ul>
      {sorted.map(team => <li key={team.id}>
        <button onClick={() => onTeam(team.id)}><TeamBadge team={team} small /><span>{team.name}</span></button>
      </li>)}
    </ul>
  </section>;
}

// memo: abrir, fechar ou compartilhar não redesenha a classificação.
const Standings = memo(function Standings({ races, data, standings, onTeam }: { races: Race[]; data: ResultsData; standings: Team[]; onTeam: (id: string) => void }) {
  const now = useNow();
  const scores = new Map(data.scores.map(s => [scoreKey(s.race_id, s.team_id), s]));
  const started = standings.some(team => team.points !== 0);

  if (!started) {
    const first = now ? nextRace(races, now) : races[0];
    return <>
      {first && <div className="results-start">
        <span className="results-start-icon"><Trophy size={18} /></span>
        <div>
          <strong>A pontuação começa na Prova {first.number}</strong>
          <span>{first.name} · {dayLabel(Date.parse(first.starts_at), now).toLowerCase()}, às {hhmm(Date.parse(first.starts_at))}</span>
        </div>
      </div>}
      <Entrants teams={standings} onTeam={onTeam} />
    </>;
  }

  const leader = standings[0]?.points ?? 0;
  return <div className="standings-layout">
    <div className="standings-side">
    <div className="podium" aria-label="Pódio">
      {[1, 0, 2].map(i => standings[i] && <button key={standings[i].id} className={`podium-place p${i + 1}`} onClick={() => onTeam(standings[i].id)}>
        <TeamBadge team={standings[i]} />
        <strong>{standings[i].name}</strong>
        <small>{int(standings[i].points)} pts</small>
        <span className="podium-block">{i + 1}º</span>
      </button>)}
    </div>
    <Legend />
    </div>

    <section className="card standings" aria-label="Classificação geral">
      <div className="standings-head" aria-hidden="true">
        <span className="score-cells">{races.map(r => <span key={r.id}>{r.number}</span>)}</span>
        <span>Total</span>
      </div>
      <ol>
        {standings.map((team, index) => {
          const gap = leader - team.points;
          return <li key={team.id}>
            <button className="standings-row" onClick={() => onTeam(team.id)}>
              <span className={`position ${index === 0 ? 'p1' : ''}`}>{index + 1}</span>
              <TeamBadge team={team} small />
              <span className="standings-main">
                <span className="standings-name">
                  <strong>{team.name}</strong>
                  {team.penalty_points < 0 && <span className="penalty-tag"><span className="sr-only">Penalidade </span>{minus(team.penalty_points)}</span>}
                </span>
                <small className="standings-gap">{index === 0 ? 'Líder' : gap === 0 ? 'Empatada com o líder' : `${minus(gap)} do líder`}{extrasOf(team) > 0 && ` · +${extrasOf(team)} extras`}</small>
                <span className="score-cells">{races.map(r => <ScoreCell key={r.id} race={r} score={scores.get(scoreKey(r.id, team.id))} />)}</span>
              </span>
              <span className="standings-total"><strong>{int(team.points)}</strong><small>pts</small></span>
            </button>
          </li>;
        })}
      </ol>
    </section>
  </div>;
});

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


/** Topo de cada prova: número, quando, nome, a situação agora e como ela é decidida. */
function RaceHeader({ race }: { race: Race }) {
  const minutes = race.duration_minutes;
  const start = Date.parse(race.starts_at);
  const rule = race.kind === 'bracket'
    ? 'Duelos X1 eliminatórios: passa quem fizer o menor tempo. Quem cai na mesma fase é ordenado pelo tempo.'
    : minutes
      ? `${minutes} min de prova, com até ${Math.round(closingMinutes(race))} min para fechar a última volta. Vence quem completar mais voltas.`
      : 'Vence quem completar mais voltas; no empate, quem fechou a última volta primeiro.';
  return <header className="race-header">
    <span>Prova {race.number} · {dayLabel(start)} · {hhmm(start)}</span>
    <h3>{race.name}</h3>
    <RaceStatus race={race} />
    <p>{rule}</p>
  </header>;
}

/** Situação da prova, com os mesmos estados da programação (e o relógio quando está valendo). */
function RaceStatus({ race }: { race: Race }) {
  const coarse = useClock(false);
  const counting = coarse > 0 && ['live', 'closing'].includes(phaseOf(itemFromRace(race), coarse).kind);
  const now = useClock(counting);
  if (!now) return null;
  const phase = phaseOf(itemFromRace(race), now);
  switch (phase.kind) {
    case 'upcoming': return <div className="race-status"><Tag tone="muted">Começa {startsIn(Date.parse(race.starts_at) - now)}</Tag></div>;
    case 'late': return <div className="race-status"><Tag tone="warn">{phase.since < LATE_AFTER ? 'Largada em instantes' : 'Atrasada'}</Tag></div>;
    case 'live': return <div className="race-status"><Tag tone="live">Agora</Tag>{phase.endsAt ? <>termina em <strong className="countdown">{clock(phase.endsAt - now)}</strong></> : `começou às ${hhmm(phase.startedAt)}`}</div>;
    case 'closing': return <div className="race-status"><Tag tone="live">Última volta</Tag>fecha em <strong className="countdown">{clock(phase.limitAt - now)}</strong></div>;
    default: return <div className="race-status"><Tag tone="muted">Encerrada</Tag></div>;
  }
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

const LapRace = memo(function LapRace({ race, data, onTeam }: { race: Race; data: ResultsData; onTeam: (id: string) => void }) {
  const laps = useRaceLaps(race.id);
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const scores = sortRace(data.scores.filter(s => s.race_id === race.id));
  // Sem nenhuma volta ainda: só a situação da prova e quem vai largar.
  if (!scores.length) return <><RaceHeader race={race} /><Entrants teams={data.teams} onTeam={onTeam} /></>;

  const teams = new Map(data.teams.map(t => [t.id, t]));
  const start = Date.parse(race.started_at ?? race.starts_at);
  const duration = race.duration_minutes ? race.duration_minutes * 60_000 : null;
  const deadline = race.duration_minutes ? start + duration! + closingMinutes(race) * 60_000 : null;
  const live = deadline !== null && now >= start && now < deadline;
  const timesOf = (teamId: string) => laps?.get(teamId) ?? [];
  const splits = new Map(scores.map(s => [s.team_id, lapSplits(timesOf(s.team_id), start)]));
  const bests = scores.flatMap(s => { const list = splits.get(s.team_id)!; return list.length ? [{ team: s.team_id, ms: Math.min(...list) }] : []; });
  const best = bests.sort((a, b) => a.ms - b.ms)[0];
  const leader = scores[0]?.status === 'ok' ? scores[0] : null;
  const leaderLast = leader?.last_lap_at ? Date.parse(leader.last_lap_at) : null;

  const lastTime = Math.max(start + (duration ?? 0), ...scores.map(s => s.last_lap_at ? Date.parse(s.last_lap_at) : start));
  const span = Math.max(lastTime - start, 60_000) * 1.04;
  const x = (time: number) => `${((time - start) / span * 100).toFixed(2)}%`;
  // Marcações em minutos redondos: no máximo 5 ao longo do gráfico.
  const step = ([5, 10, 15, 20, 30, 60, 120].find(m => span / 60_000 / m <= 5) ?? 240) * 60_000;
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => i * step);

  function detail(score: Score) {
    if (score.status === 'dns') return 'Não largou';
    const voltas = `${score.laps} ${score.laps === 1 ? 'volta' : 'voltas'}`;
    if (score.status === 'dnf') return `Não terminou · ${voltas}`;
    const last = score.last_lap_at ? Date.parse(score.last_lap_at) : null;
    // Quem está voltas atrás mostra só a diferença em voltas; na mesma volta, o tempo atrás do líder.
    if (leader && score !== leader && leaderLast && last) {
      const behind = leader.laps - score.laps;
      return `${voltas} · ${behind > 0 ? `−${behind} ${behind === 1 ? 'volta' : 'voltas'}` : `+${formatDuration(last - leaderLast)}`}`;
    }
    return last ? `${voltas} · ${formatDuration(last - start)}` : voltas;
  }

  return <>
    <RaceHeader race={race} />
    <div className="lap-layout">
    <div className="lap-side">
    <div className="race-summary">
      <div><span>{live ? 'Liderando' : 'Vencedor'}</span><strong className="name">{leader ? teams.get(leader.team_id)?.name : '–'}</strong><small>{leader ? `${leader.laps} voltas` : 'a definir'}</small></div>
      <div><span>Melhor volta</span><strong>{best ? formatDuration(best.ms) : '–'}</strong><small>{best ? teams.get(best.team)?.name : 'a definir'}</small></div>
      <div><span>Terminaram</span><strong>{scores.filter(s => s.status === 'ok').length}/{scores.length}</strong><small>{scores.filter(s => s.status === 'dnf').length} DNF · {scores.filter(s => s.status === 'dns').length} DNS</small></div>
    </div>
    {live && <p className="live-note"><span className="live-dot" /> Parcial: a prova ainda está acontecendo.</p>}

    {laps && laps.size > 0 && <section className="card lap-chart" aria-label="Voltas ao longo da prova">
      <div className="lap-chart-title"><h2>Voltas ao longo da prova</h2><small>cada ponto é uma volta</small></div>
      <div className="lap-lanes">
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
      <div className="lap-ticks" aria-hidden="true">{ticks.map(ms => <span key={ms} style={{ left: x(start + ms) }}>{ms ? formatTick(ms) : '0'}</span>)}</div>
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
              <span className="race-row-points"><strong>{score.points}</strong><small>pts</small></span>
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
});

// Chave do Match Race desenhada em px: cada coluna é uma fase e o duelo seguinte
// fica na altura do meio dos dois que o alimentam.
const CARD_W = 176, CARD_H = 64, GAP_X = 36, SLOT = 80, HEAD = 28;

const MatchRace = memo(function MatchRace({ race, data, onTeam }: { race: Race; data: ResultsData; onTeam: (id: string) => void }) {
  const duels = data.duels.filter(d => d.race_id === race.id);
  const published = sortRace(data.scores.filter(s => s.race_id === race.id));
  const pending = !published.length;
  // Sem chave montada nem resultado: só a situação da prova e quem vai disputar.
  if (pending && !duels.length) return <><RaceHeader race={race} /><Entrants teams={data.teams} onTeam={onTeam} /></>;
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
});

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
