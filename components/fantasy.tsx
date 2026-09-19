'use client';
import { useState } from 'react';
import { Check, CircleHelp, Copy, Lock, Plus, Sun, X } from 'lucide-react';
import { fantasyPlayers, lineupSlots, races, teams, type Race, type Team } from '@/lib/mock-data';
import { raceDate, raceTime, useStartedCount } from '@/lib/races';
import { useLocalState } from '@/lib/local-state';
import { useApp } from './app-shell';
import { Sheet, TeamBadge } from './ui';

// Uma escalação por prova: ids na ordem de lineupSlots ('' = vaga livre).
type Lineups = Record<string, string[]>;
const emptyLineup = () => lineupSlots.map(() => '');
const tierLabel = { A: 'Tier A', B: 'Tier B', C: 'Tier C' };

// Pontuação demonstrativa de um barco em uma prova já disputada.
const raceScore = (team: Team, race: Race) => Math.round(team.points / 8) + ((race.number * 7 + team.id.charCodeAt(1)) % 15);

export function Fantasy() {
  const [lineups, setLineups] = useLocalState<Lineups>('dsb-fantasy', {});
  const [name] = useLocalState('dsb-name', 'Torcedor Solar');
  const [guest] = useLocalState('dsb-guest', false);
  const started = useStartedCount();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [rules, setRules] = useState(false);
  const { notify } = useApp();

  const race = races.find(r => r.id === selectedId) ?? races[Math.min(started, races.length - 1)];
  const locked = (r: Race) => races.indexOf(r) < started;
  const lineupOf = (r: Race) => lineups[r.id] ?? emptyLineup();
  const lineup = lineupOf(race);
  const filled = (r: Race) => lineupOf(r).filter(Boolean).length;
  const complete = races.filter(r => filled(r) === lineupSlots.length).length;
  const myPoints = races.filter(locked).reduce((sum, r) => sum + lineupOf(r).reduce((s, id) => { const team = teams.find(t => t.id === id); return s + (team ? raceScore(team, r) : 0); }, 0), 0);
  const ranking = [...fantasyPlayers, { name: guest ? 'Você' : name, points: myPoints, you: true }].sort((a, b) => b.points - a.points);

  function setSlot(slot: number, id: string) {
    const next = [...lineup]; next[slot] = id;
    setLineups({ ...lineups, [race.id]: next });
    setPicking(null);
  }
  function copyForward() {
    const next = { ...lineups };
    races.slice(races.indexOf(race) + 1).forEach(r => { if (!locked(r)) next[r.id] = [...lineup]; });
    setLineups(next);
    notify('Escalação repetida em todas as próximas provas.');
  }

  const pickingTier = picking === null ? null : lineupSlots[picking];
  const isLocked = locked(race);

  return <div className="page fantasy">
    <div className="page-heading">
      <div><h1>Fantasy</h1><p>Para cada prova, escale 1 barco do tier A, 2 do tier B e 1 do tier C.</p></div>
      <button className="button" onClick={() => setRules(true)}><CircleHelp size={16} /> Como jogar</button>
    </div>
    <div className="fantasy-grid">
      <div className="race-list" role="tablist" aria-label="Provas">
        {races.map(r => {
          const count = filled(r);
          return <button key={r.id} role="tab" aria-selected={r.id === race.id} onClick={() => setSelectedId(r.id)}>
            <span className="race-number">Prova {r.number}</span>
            <strong>{r.name}</strong>
            <small>{raceDate(r)} · {raceTime(r)}</small>
            <span className={`race-status ${locked(r) ? 'locked' : count === lineupSlots.length ? 'done' : ''}`}>
              {locked(r) ? <><Lock size={11} /> Encerrada</> : count === lineupSlots.length ? <><Check size={11} /> Escalada</> : `${count}/${lineupSlots.length}`}
            </span>
          </button>;
        })}
      </div>

      <section className="card lineup">
        <div className="lineup-heading">
          <div><h2>Prova {race.number} · {race.name}</h2><p>{isLocked ? 'Escalação travada: a prova já largou.' : `Você pode editar até a largada: ${raceDate(race)}, ${raceTime(race)}.`}</p></div>
          {!isLocked && filled(race) === lineupSlots.length && race !== races[races.length - 1] && <button className="button" onClick={copyForward}><Copy size={15} /> Repetir nas próximas</button>}
        </div>
        <div className="slots">
          {lineupSlots.map((tier, slot) => {
            const team = teams.find(t => t.id === lineup[slot]);
            return <button key={slot} className={`slot ${team ? 'filled' : ''}`} disabled={isLocked} onClick={() => setPicking(slot)} aria-label={team ? `${tierLabel[tier]}: ${team.name}. Trocar` : `Escolher barco ${tierLabel[tier]}`}>
              <span className={`tier tier-${tier}`}>{tierLabel[tier]}</span>
              {team ? <><TeamBadge team={team} /><strong>{team.name}</strong><small>{team.university.split(' · ')[0]}</small></>
                : <><span className="slot-empty"><Plus size={22} /></span><strong>Escolher barco</strong><small>&nbsp;</small></>}
            </button>;
          })}
        </div>
        <p className="footnote">{complete} de {races.length} provas escaladas.</p>
      </section>

      <aside className="card ranking">
        <div className="ranking-heading"><h2>Ranking</h2><span className="tag">{ranking.length} participantes</span></div>
        <ol>
          {ranking.map((player, index) => <li key={player.name + index} className={'you' in player ? 'you' : ''}>
            <span className={`position p${index + 1}`}>{index + 1}</span>
            <span className="avatar small">{'you' in player ? <Sun size={14} /> : player.name.split(' ').map(p => p[0]).join('').slice(0, 2)}</span>
            <span className="ranking-name">{player.name}{'you' in player && <small> (você)</small>}</span>
            <strong>{player.points}<small> pts</small></strong>
          </li>)}
        </ol>
        <p className="footnote">Ranking e pontos ilustrativos nesta demonstração.</p>
      </aside>
    </div>

    <Sheet open={picking !== null} onClose={() => setPicking(null)} title={pickingTier ? `Escolha um barco · ${tierLabel[pickingTier]}` : ''}>
      {picking !== null && <div className="picker">
        {teams.filter(t => t.tier === pickingTier).map(team => {
          const current = lineup[picking] === team.id;
          const used = !current && lineup.includes(team.id);
          return <button key={team.id} className={`picker-row ${current ? 'selected' : ''}`} disabled={used} onClick={() => setSlot(picking, team.id)}>
            <TeamBadge team={team} />
            <span><strong>{team.name}</strong><small>{used ? 'Já está na sua escalação' : team.university}</small></span>
            <span className="picker-points">{team.points}<small> pts</small></span>
            {current && <Check size={18} />}
          </button>;
        })}
        {lineup[picking] && <button className="button danger" onClick={() => setSlot(picking, '')}><X size={16} /> Liberar vaga</button>}
      </div>}
    </Sheet>

    <Sheet open={rules} onClose={() => setRules(false)} title="Como jogar">
      <ol className="rules">
        <li><strong>Uma escalação por prova</strong><p>São 7 provas. Monte sua equipe separadamente para cada uma.</p></li>
        <li><strong>4 barcos: 1 A, 2 B e 1 C</strong><p>Os barcos são divididos em tiers pelo desempenho. Equilibre favoritos e apostas.</p></li>
        <li><strong>Trava na largada</strong><p>Você pode trocar os barcos até o horário de início de cada prova.</p></li>
        <li><strong>Suba no ranking</strong><p>Os pontos que seus barcos fazem na prova somam para você no ranking geral.</p></li>
      </ol>
      <p className="footnote">Fantasy gratuito e demonstrativo, sem apostas ou prêmios. Sua escalação fica salva apenas neste dispositivo.</p>
    </Sheet>
  </div>;
}
