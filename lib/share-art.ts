// Artes para o Instagram desenhadas num canvas, com os mesmos dados da tela de resultados.
// Story (1080×1920) com a classificação geral e post (1080×1350) com o resultado de uma prova.
import type { Race, Team } from './data';
import { formatDuel, formatDuration, lapSplits, sortRace, sortStandings, stageLabel, type Score } from './scoring';
import type { ResultsData } from './results';
import { supabase } from './supabase';

const BRAND = '#422378', DEEP = '#2d1856', ACCENT = '#ffc51c', LILAC = '#d9cdf0';
const int = (n: number) => n.toLocaleString('pt-BR');

type Ctx = CanvasRenderingContext2D;
type Logos = Map<string, HTMLImageElement>;

function font(ctx: Ctx, weight: number, size: number, mono = false) {
  const family = getComputedStyle(document.body).getPropertyValue(mono ? '--font-geist-mono' : '--font-geist-sans').trim() || 'system-ui';
  ctx.font = `${weight} ${size}px ${family}, ${mono ? 'monospace' : 'system-ui, sans-serif'}`;
}

function fit(ctx: Ctx, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadLogos(teams: Team[]): Promise<Logos> {
  const entries = await Promise.all(teams.filter(t => t.logo).map(async t => [t.id, await loadImage(`/logos/${t.logo}`)] as const));
  return new Map(entries.filter((e): e is [string, HTMLImageElement] => !!e[1]));
}

/** Logo inteiro, com cantos levemente arredondados e fundo branco; sem logo, as iniciais. */
function logo(ctx: Ctx, logos: Logos, team: Team, cx: number, cy: number, size: number, ring?: string) {
  const radius = size * .18, border = size * .05;
  ctx.save();
  if (ring) { ctx.beginPath(); ctx.roundRect(cx - size / 2 - border, cy - size / 2 - border, size + border * 2, size + border * 2, radius + border); ctx.fillStyle = ring; ctx.fill(); }
  ctx.beginPath(); ctx.roundRect(cx - size / 2, cy - size / 2, size, size, radius); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
  const img = logos.get(team.id);
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.fillStyle = BRAND; font(ctx, 700, size * .34); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(team.initials, cx, cy);
  }
  ctx.restore();
}

function text(ctx: Ctx, value: string, x: number, y: number, opts: { weight?: number; size: number; color: string; align?: CanvasTextAlign; mono?: boolean; max?: number; spacing?: number }) {
  font(ctx, opts.weight ?? 400, opts.size, opts.mono);
  ctx.fillStyle = opts.color; ctx.textAlign = opts.align ?? 'left'; ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${opts.spacing ?? 0}px`;
  ctx.fillText(opts.max ? fit(ctx, value, opts.max) : value, x, y);
  ctx.letterSpacing = '0px';
}

function canvas(width: number, height: number) {
  const el = document.createElement('canvas');
  el.width = width; el.height = height;
  return [el, el.getContext('2d')!] as const;
}

const toBlob = (el: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => el.toBlob(b => b ? resolve(b) : reject(new Error('canvas vazio')), 'image/png'));

/** Story com o pódio e do 4º ao 10º da classificação geral. */
export async function drawStandingsStory(data: ResultsData, races: Race[]) {
  await document.fonts.ready;
  const standings = sortStandings(data.teams);
  const logos = await loadLogos(standings.slice(0, 10));
  const done = new Set(data.scores.map(s => s.race_id)).size;
  const [el, ctx] = canvas(1080, 1920);
  ctx.fillStyle = DEEP; ctx.fillRect(0, 0, 1080, 1920);

  text(ctx, 'DESAFIO SOLAR BRASIL · MACAÉ 2026', 80, 150, { weight: 700, size: 30, color: ACCENT, spacing: 4 });
  text(ctx, 'Classificação', 80, 270, { weight: 800, size: 104, color: '#ffffff', spacing: -4 });
  text(ctx, done >= races.length ? 'final' : 'geral', 80, 370, { weight: 800, size: 104, color: '#ffffff', spacing: -4 });
  if (done < races.length) text(ctx, `após ${done} de ${races.length} provas`, 1000, 370, { size: 34, color: LILAC, align: 'right' });

  // Pódio: 2º, 1º, 3º lado a lado, com blocos de alturas diferentes.
  const baseY = 1000, colW = 280;
  [[1, 230, 150], [0, 540, 210], [2, 850, 110]].forEach(([i, cx, block]) => {
    const team = standings[i];
    if (!team) return;
    const first = i === 0, size = first ? 230 : 180;
    const top = baseY - block;
    ctx.fillStyle = first ? ACCENT : 'rgba(255,255,255,.11)';
    ctx.beginPath(); ctx.roundRect(cx - colW / 2, top, colW, block, [28, 28, 0, 0]); ctx.fill();
    text(ctx, `${i + 1}º`, cx, top + 78, { weight: 800, size: 60, color: first ? DEEP : '#ffffff', align: 'center' });
    text(ctx, `${int(team.points)} pts`, cx, top - 28, { size: 32, color: LILAC, align: 'center', mono: true });
    text(ctx, team.name, cx, top - 80, { weight: 700, size: 40, color: '#ffffff', align: 'center', max: colW + 20 });
    logo(ctx, logos, team, cx, top - 130 - size / 2, size, first ? ACCENT : 'rgba(255,255,255,.25)');
  });

  standings.slice(3, 10).forEach((team, i) => {
    const y = 1050 + i * 108;
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.roundRect(80, y, 920, 94, 24); ctx.fill();
    text(ctx, `${i + 4}º`, 112, y + 60, { weight: 600, size: 34, color: LILAC, mono: true });
    logo(ctx, logos, team, 240, y + 47, 64);
    text(ctx, team.name, 296, y + 60, { weight: 600, size: 38, color: '#ffffff', max: 520 });
    text(ctx, int(team.points), 968, y + 60, { weight: 600, size: 38, color: '#ffffff', align: 'right', mono: true });
  });

  text(ctx, 'Todas as provas e voltas no app DSB', 80, 1840, { size: 30, color: LILAC });
  return toBlob(el);
}

/** Post com os 8 primeiros de uma prova. */
export async function drawRacePost(data: ResultsData, race: Race) {
  await document.fonts.ready;
  const scores = sortRace(data.scores.filter(s => s.race_id === race.id)).slice(0, 8);
  const teams = new Map(data.teams.map(t => [t.id, t]));
  const logos = await loadLogos(scores.map(s => teams.get(s.team_id)).filter((t): t is Team => !!t));
  const [el, ctx] = canvas(1080, 1350);
  ctx.fillStyle = '#f7f7fa'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = BRAND; ctx.fillRect(0, 0, 1080, 300);

  text(ctx, `PROVA ${race.number} · RESULTADO`, 72, 110, { weight: 700, size: 26, color: ACCENT, spacing: 3 });
  text(ctx, race.name, 72, 220, { weight: 800, size: race.name.length > 16 ? 70 : 92, color: '#ffffff', spacing: -3, max: 640 });

  // Destaque à direita: melhor volta nas provas de voltas, tempo do campeão no Match Race.
  const start = Date.parse(race.started_at ?? race.starts_at);
  let highlight: { label: string; value: string; team: string } | null = null;
  if (race.kind === 'laps') {
    const { data: laps } = await supabase.from('race_laps').select('team_id, completed_at').eq('race_id', race.id);
    const byTeam = new Map<string, number[]>();
    for (const row of laps ?? []) byTeam.set(row.team_id, [...(byTeam.get(row.team_id) ?? []), Date.parse(row.completed_at)]);
    let best: { team: string; ms: number } | null = null;
    for (const [team, times] of byTeam) for (const ms of lapSplits(times, start)) if (!best || ms < best.ms) best = { team, ms };
    if (best) highlight = { label: 'Melhor volta', value: formatDuration(best.ms), team: teams.get(best.team)?.name ?? '' };
  } else if (scores[0]?.duel_time) {
    highlight = { label: 'Campeão', value: formatDuel(scores[0].duel_time), team: teams.get(scores[0].team_id)?.name ?? '' };
  }
  if (highlight) {
    text(ctx, highlight.label, 1008, 150, { size: 26, color: LILAC, align: 'right' });
    text(ctx, highlight.value, 1008, 205, { weight: 600, size: 44, color: '#ffffff', align: 'right', mono: true });
    text(ctx, highlight.team, 1008, 245, { size: 26, color: LILAC, align: 'right', max: 300 });
  }

  const leader = scores[0];
  scores.forEach((score, i) => {
    const team = teams.get(score.team_id);
    if (!team) return;
    const y = 340 + i * 112;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ebe9f0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(72, y, 936, 98, 22); ctx.fill(); ctx.stroke();
    const tone = score.position === 1 ? [ACCENT, DEEP] : score.position === 2 ? ['#e4e1ea', '#3d3a52'] : score.position === 3 ? ['#f0dcc8', '#6b3f1f'] : ['#f1edf8', BRAND];
    ctx.fillStyle = tone[0]; ctx.beginPath(); ctx.roundRect(96, y + 21, 76, 56, 16); ctx.fill();
    text(ctx, score.position ? `${score.position}º` : score.status.toUpperCase(), 134, y + 59, { weight: 600, size: 26, color: tone[1], align: 'center', mono: true });
    logo(ctx, logos, team, 230, y + 49, 62);
    text(ctx, team.name, 280, y + 46, { weight: 700, size: 34, color: '#252332', max: 540 });
    text(ctx, detail(score, leader, start), 280, y + 80, { size: 23, color: '#656785', max: 540 });
    text(ctx, `${score.points} pts`, 984, y + 62, { weight: 600, size: 36, color: '#252332', align: 'right', mono: true });
  });

  text(ctx, 'Desafio Solar Brasil · Macaé 2026', 72, 1300, { size: 26, color: '#656785' });
  text(ctx, 'Resultado completo no app DSB', 1008, 1300, { size: 26, color: '#656785', align: 'right' });
  return toBlob(el);
}

/** Antes do resultado: post com as equipes inscritas (geral) ou o anúncio da largada de uma prova. */
export async function drawLineupPost(data: ResultsData, races: Race[], race: Race | null) {
  await document.fonts.ready;
  const teams = [...data.teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const logos = await loadLogos(teams);
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const time = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const [el, ctx] = canvas(1080, 1350);
  ctx.fillStyle = '#f7f7fa'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = BRAND; ctx.fillRect(0, 0, 1080, 330);

  text(ctx, race ? `PROVA ${race.number} · DESAFIO SOLAR BRASIL` : 'DESAFIO SOLAR BRASIL · MACAÉ 2026', 72, 110, { weight: 700, size: 26, color: ACCENT, spacing: 3 });
  text(ctx, race ? race.name : 'Equipes inscritas', 72, 215, { weight: 800, size: 88, color: '#ffffff', spacing: -3, max: 936 });
  const when = race
    ? `Largada ${time.format(new Date(race.starts_at)).replace(' às ', ', às ')}`
    : `${teams.length} equipes · ${day.format(new Date(races[0].starts_at))} a ${day.format(new Date(races[races.length - 1].starts_at))}`;
  text(ctx, when, 72, 275, { size: 32, color: LILAC, max: 936 });

  // Grade de logos: 5 por linha, altura ajustada ao número de equipes.
  const cols = 5, rows = Math.ceil(teams.length / cols);
  const cellW = 936 / cols, cellH = Math.min(270, 860 / Math.max(rows, 1)), size = Math.min(140, cellH - 70);
  teams.forEach((team, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, teams.length - row * cols);
    const cx = 72 + (1080 - 144 - inRow * cellW) / 2 + (i % cols) * cellW + cellW / 2;
    const top = 380 + row * cellH;
    logo(ctx, logos, team, cx, top + size / 2, size);
    text(ctx, team.name, cx, top + size + 42, { weight: 600, size: 24, color: '#252332', align: 'center', max: cellW - 16 });
  });

  text(ctx, 'Desafio Solar Brasil · Macaé 2026', 72, 1300, { size: 26, color: '#656785' });
  text(ctx, 'Acompanhe ao vivo no app DSB', 1008, 1300, { size: 26, color: '#656785', align: 'right' });
  return toBlob(el);
}

function detail(score: Score, leader: Score, start: number) {
  if (score.status === 'dns') return 'Não largou';
  if (score.status === 'dnf') return `Não terminou · ${score.laps} voltas`;
  if (score.stage) return stageLabel[score.stage] + (score.duel_time && (score.position ?? 0) > 4 ? ` · ${formatDuel(score.duel_time)}` : '');
  const last = score.last_lap_at ? Date.parse(score.last_lap_at) : null;
  if (!last) return `${score.laps} voltas`;
  if (score === leader) return `${score.laps} voltas · ${formatDuration(last - start)}`;
  const behind = leader.laps - score.laps;
  const leaderLast = leader.last_lap_at ? Date.parse(leader.last_lap_at) : last;
  return `${score.laps} voltas · ${behind > 0 ? `−${behind} ${behind === 1 ? 'volta' : 'voltas'}` : `+${formatDuration(last - leaderLast)}`}`;
}
