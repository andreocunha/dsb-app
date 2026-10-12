'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Count = { label: string; total: number };
/** new: aparelhos que apareceram naquele dia. estimated: dia reconstruído pelos logins, de antes da contagem por aparelho. */
type Day = Count & { opens: number; new: number; estimated: boolean };
type InstallStats = {
  since: string | null; estimated_devices: number; ios: number; android: number; web: number; logged: number;
  push_granted: number; push_denied: number; push_ask: number; active_7d: number; accounts: number;
  devices: Count[]; systems: Count[]; versions: Count[]; days: Day[]; frequency: Count[];
};

const DAYS = 14;
const DAY = 86_400_000;
const dayLabel = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const number = (total: number) => total.toLocaleString('pt-BR');
const plural = (total: number, one: string, many: string) => `${number(total)} ${total === 1 ? one : many}`;

/** Os últimos 14 dias em ordem, com zero nos dias em que ninguém abriu (o banco só devolve os que têm). */
function lastDays(days: Day[], now: number): Day[] {
  const known = new Map(days.map(d => [d.label, d]));
  return Array.from({ length: DAYS }, (_, i) => {
    const label = dayLabel.format(now - (DAYS - 1 - i) * DAY);
    return known.get(label) ?? { label, total: 0, opens: 0, new: 0, estimated: false };
  });
}

/** "iOS 18.7" e "iOS 18.3.2" viram "iOS 18": por versão cheia a lista cresceria a cada atualização. */
function byMajor(counts: Count[]): Count[] {
  const totals = new Map<string, number>();
  for (const c of counts) {
    const label = c.label.replace(/^(\S+ \d+)\..*$/, '$1');
    totals.set(label, (totals.get(label) ?? 0) + c.total);
  }
  return [...totals].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
}

function Tile({ label, value, note, children }: { label: string; value: number; note?: string; children?: React.ReactNode }) {
  return <div className="stat-tile">
    <span className="stat-label">{label}</span>
    <strong className="stat-value">{number(value)}</strong>
    {children}
    {note && <small className="stat-note">{note}</small>}
  </div>;
}

/** Quanto do total: a parte preenchida é o valor do bloco; o trilho, o total de aparelhos. */
function Meter({ value, max }: { value: number; max: number }) {
  return <div className="stat-meter" aria-hidden><span style={{ width: `${max ? Math.min(value / max, 1) * 100 : 0}%` }} /></div>;
}

/** Aparelhos por dia. Tocar (ou passar o mouse) numa coluna mostra os números do dia; o padrão é hoje. */
function DayChart({ days }: { days: Day[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const active = days.find(d => d.label === picked) ?? days[days.length - 1];
  const max = Math.max(...days.map(d => d.total), 1);
  return <div className="settings-card day-chart">
    <p className="day-readout" aria-live="polite">
      <strong>{active.label}</strong> · {plural(active.total, 'aparelho', 'aparelhos')} · {plural(active.new, 'novo', 'novos')} · {plural(active.opens, 'abertura', 'aberturas')}
      {active.estimated && <span className="day-tag">estimado</span>}
    </p>
    <div className="day-plot" onPointerLeave={() => setPicked(null)}>
      <span className="day-max" aria-hidden>{number(max)}</span>
      {days.map(d => <button key={d.label} type="button" className={`day-column ${d.estimated ? 'estimated' : ''}`} aria-pressed={d.label === active.label}
        aria-label={`${d.label}: ${plural(d.total, 'aparelho', 'aparelhos')}, ${plural(d.new, 'novo', 'novos')}, ${plural(d.opens, 'abertura', 'aberturas')}${d.estimated ? ' (estimado)' : ''}`}
        onPointerEnter={() => setPicked(d.label)} onFocus={() => setPicked(d.label)} onClick={() => setPicked(d.label)}>
        <span className="day-bar" style={{ height: `${d.total / max * 100}%` }} />
        <small>{d.label.slice(0, 2)}</small>
      </button>)}
    </div>
    {days.some(d => d.estimated) && <p className="day-legend"><i aria-hidden />Estimado pelos logins no app, de antes da contagem por aparelho</p>}
  </div>;
}

/** Lista em barras, da maior para a menor. Com muitos itens mostra os primeiros e guarda o resto atrás de "Ver todos". */
function BarList({ counts, limit }: { counts: Count[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...counts.map(c => c.total), 1);
  const folded = !!limit && counts.length > limit;
  return <div className="settings-card bar-card">
    <ul className="bar-list">{(folded && !all ? counts.slice(0, limit) : counts).map(c => <li key={c.label}>
      <span className="bar-label">{c.label}</span>
      <b>{number(c.total)}</b>
      <span className="bar-track" aria-hidden><span style={{ width: `${c.total / max * 100}%` }} /></span>
    </li>)}</ul>
    {folded && <button type="button" className="bar-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver todos (${counts.length})`}</button>}
  </div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="settings-group">
    <h2 className="settings-label">{title}</h2>
    {children}
  </section>;
}

/** Quem tem o app, em que aparelho, quantos entraram na conta, aceitaram notificações e voltam (lib/install.ts). */
export function StatsPanel() {
  const [stats, setStats] = useState<(InstallStats & { at: number }) | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void supabase.rpc('install_stats').then(({ data, error }) => {
      if (error || !data) setFailed(true);
      else setStats({ ...(data as unknown as InstallStats), at: Date.now() });
    });
  }, []);
  if (!stats) return <p className="panel-note">{failed ? 'Não foi possível carregar os números.' : 'Carregando…'}</p>;

  const app = stats.ios + stats.android;
  const share = (total: number) => app ? `${Math.round(total / app * 100)}% dos aparelhos` : undefined;
  const since = stats.since && dayLabel.format(new Date(stats.since));
  return <div className="admin-stats">
    <Group title="App das lojas">
      <div className="stat-tiles">
        <Tile label="Aparelhos com o app" value={app}>
          <div className="stat-split" aria-hidden>
            {stats.android > 0 && <span className="series-1" style={{ flexGrow: stats.android }} />}
            {stats.ios > 0 && <span className="series-2" style={{ flexGrow: stats.ios }} />}
          </div>
          <ul className="stat-legend">
            <li><i className="series-1" />Android <b>{number(stats.android)}</b></li>
            <li><i className="series-2" />iPhone e iPad <b>{number(stats.ios)}</b></li>
          </ul>
        </Tile>
        <Tile label="Entraram na conta" value={stats.logged} note={share(stats.logged)}><Meter value={stats.logged} max={app} /></Tile>
        <Tile label="Aceitaram notificações" value={stats.push_granted}
          note={`${plural(stats.push_denied, 'recusou', 'recusaram')} · ${plural(stats.push_ask, 'não respondeu', 'não responderam')}`}>
          <Meter value={stats.push_granted} max={app} />
        </Tile>
        <Tile label="Abriram nos últimos 7 dias" value={stats.active_7d} note={share(stats.active_7d)}><Meter value={stats.active_7d} max={app} /></Tile>
        <Tile label="Navegadores no site" value={stats.web} note="Abriram dsb.app.br sem o app" />
        <Tile label="Contas criadas" value={stats.accounts} note="Pelo app ou pelo site" />
      </div>
    </Group>

    <Group title="Aparelhos que abriram o app por dia"><DayChart days={lastDays(stats.days, stats.at)} /></Group>

    <div className="stat-columns">
      {stats.frequency.length > 0 && <Group title="Quantas vezes abriram"><BarList counts={stats.frequency} /></Group>}
      {stats.systems.length > 0 && <Group title="Sistema"><BarList counts={byMajor(stats.systems)} limit={6} /></Group>}
      {stats.versions.length > 0 && <Group title="Versão do app"><BarList counts={stats.versions} limit={6} /></Group>}
      {stats.devices.length > 0 && <Group title="Modelos"><BarList counts={stats.devices} limit={6} /></Group>}
    </div>

    <p className="settings-hint">{since ? `A contagem por aparelho começou em ${since}. ` : 'Nenhum aparelho registrado ainda. '}
      {stats.estimated_devices > 0 && `O que vem de antes foi reconstruído pelos logins no app: não inclui quem usou sem entrar na conta, e ${plural(stats.estimated_devices, 'aparelho ainda é conhecido', 'aparelhos ainda são conhecidos')} só por esse histórico, até abrir o app de novo. `}
      Reinstalar conta de novo, e voltar ao app depois de 30 minutos conta como outra abertura. O total de downloads fica no Google Play Console e no App Store Connect.</p>
  </div>;
}
