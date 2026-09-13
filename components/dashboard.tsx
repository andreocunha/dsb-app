'use client';

import Image from 'next/image';
import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, Clock3, ExternalLink, Map, Radio, Trophy } from 'lucide-react';
import { teams, nextRace } from '@/lib/mock-data';
import { eventConfig, youtubeEmbedUrl } from '@/lib/event-config';
import { TeamBadge } from './ui';
import styles from './dashboard.module.css';

const tabs = [
  { id: 'map', label: 'Mapa', icon: Map },
  { id: 'results', label: 'Resultado', icon: Trophy },
  { id: 'live', label: 'Live', icon: Radio },
] as const;
type Tab = typeof tabs[number]['id'];

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('map');
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabButtons.current[next]?.focus();
  }

  return (
    <div className={styles.home}>
      <section className={styles.race} aria-label="Próxima prova">
        <div className={styles.raceVisual}>
        <Image
          src="/images/event-race.jpg"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 320px"
          alt="Uma etapa do Desafio Solar Brasil na Baía de Guanabara"
          className={styles.racePhoto}
        />
        <div className={styles.raceShade} />
        </div>
        <div className={styles.raceContent}>
          <span className={styles.raceCategory}><Trophy size={21} /><span className={styles.mobileCategory}>Competição</span><span className={styles.desktopCategory}>Próxima prova</span></span>
          <h1>{nextRace.name}</h1>
          <div className={styles.raceDetails}>
            <span><CalendarDays size={23} /><time dateTime={nextRace.date}>{nextRace.day}<span className={styles.desktopDate}>, {new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${nextRace.date}T12:00:00Z`))}</span></time></span>
            <span><Clock3 size={23} /><time dateTime={`${nextRace.date}T${nextRace.time}:00-03:00`}>{nextRace.time}</time></span>
          </div>
        </div>
      </section>

      <section aria-label="Acompanhar o evento" className={styles.coverage}>
        <div className={styles.tabs} role="tablist" aria-label="Acompanhar o evento">
          {tabs.map((item, index) => (
            <button
              key={item.id}
              ref={element => { tabButtons.current[index] = element; }}
              id={`tab-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? styles.active : ''}
              onClick={() => setTab(item.id)}
              onKeyDown={event => moveTab(event, index)}
            >
              <item.icon size={23} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        {tabs.map(item => (
          <div
            key={item.id}
            id={`panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${item.id}`}
            hidden={tab !== item.id}
            tabIndex={0}
            className={styles.panel}
          >
            {tab === item.id && (
              item.id === 'map' ? <RaceMap /> :
              item.id === 'results' ? <Results /> : <LivePanel />
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function Results() {
  return (
    <div className={styles.results}>
      <table>
        <caption className="sr-only">Classificação geral demonstrativa do Desafio Solar Brasil</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Equipe</th><th scope="col">Pontos</th></tr></thead>
        <tbody>
          {teams.map((team, index) => (
            <tr key={team.id}>
              <td>{index + 1}</td>
              <td><div className={styles.team}><TeamBadge team={team} /><span>{team.name}</span></div></td>
              <td>{team.points}<small> pts</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RaceMap() {
  return (
    <div className={styles.map}>
      <iframe
        src={eventConfig.trackingUrl}
        title="Rastreamento das embarcações do Desafio Solar Brasil"
        allow="fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <a className={styles.mapLink} href={eventConfig.trackingUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir mapa em outra aba">
        <ExternalLink size={19} />
      </a>
    </div>
  );
}

function LivePanel() {
  const embedUrl = youtubeEmbedUrl(eventConfig.youtubeUrl);
  return (
    <div className={styles.live}>
      {embedUrl ? (
        <iframe
          className={styles.video}
          src={embedUrl}
          title="Transmissão do Desafio Solar Brasil no YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className={styles.waiting}>
          <Image src="/images/event-race.jpg" fill sizes="(max-width: 768px) 100vw, 1040px" alt="Desafio Solar Brasil" />
          <div className={styles.waitingShade} />
          <div className={styles.waitingMessage}><Radio size={35} /><p>A transmissão começa em breve.</p></div>
        </div>
      )}
      <div className={styles.liveTitle}>
        <div><h2>Desafio Solar Brasil{embedUrl ? ' — ao vivo' : ''}</h2><p>Transmissão no YouTube</p></div>
        {embedUrl && <a href={eventConfig.youtubeUrl} target="_blank" rel="noopener noreferrer" aria-label="Assistir no YouTube"><ExternalLink size={20} /></a>}
      </div>
    </div>
  );
}
