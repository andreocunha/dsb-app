'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ban, ChevronRight, FileText, Images, Link2, LogOut, Moon, Palette, Play, Settings, Share2, ShieldCheck, Sun, ThumbsDown, X } from 'lucide-react';
import { formatSize } from '@/lib/media';
import { shortName } from '@/lib/names';
import { registerOverlay } from '@/lib/overlays';
import { chatFileUrl, supabase } from '@/lib/supabase';
import { useApp } from '../app-shell';
import { useAuth } from '../auth';
import { Avatar } from '../ui';
import { isVideo, type Message } from './types';

type View = 'info' | 'media' | 'rules' | 'blocked';
type Person = { id: string; name: string; avatar_url: string | null };

const contato = 'andreoliveiracunha20@gmail.com';
const COLUMNS = 'id, user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, created_at, deleted_at, deleted_by';
// Valores com ":" e "." vão entre aspas dentro do or() do PostgREST.
const LINKS = 'body.ilike."*http://*",body.ilike."*https://*",body.ilike."*www.*"';
const TITLES: Record<View, string> = { info: 'Dados do grupo', media: 'Mídia, links e docs', rules: 'Regras do chat', blocked: 'Pessoas bloqueadas' };
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

async function fetchMessages(kind: 'media' | 'docs' | 'links', limit: number) {
  let query = supabase.from('messages').select(COLUMNS).is('deleted_at', null).order('id', { ascending: false }).limit(limit);
  if (kind === 'media') query = query.not('file_path', 'is', null).or('file_type.like.image/*,file_type.like.video/*');
  if (kind === 'docs') query = query.not('file_path', 'is', null).not('file_type', 'like', 'image/*').not('file_type', 'like', 'video/*');
  if (kind === 'links') query = query.or(LINKS);
  const { data } = await query;
  return (data ?? []).map(row => ({ ...row, reply_to: null, edited_at: null, reactions: [], reply: null })) as Message[];
}

/**
 * Dados do grupo, no formato do WhatsApp: tela cheia no celular, painel à direita no desktop.
 * Cada linha faz algo de verdade no app (mídia, regras, tema, bloqueados, termos).
 */
export function GroupInfo({ open, initialView, online, blocked, onUnblock, onOpenMedia, onClose }: {
  open: boolean; initialView: View; online: number; blocked: string[];
  onUnblock: (id: string) => void; onOpenMedia: (message: Message) => void; onClose: () => void;
}) {
  const { theme, setTheme, notify } = useApp();
  const { userId, profile, signOut } = useAuth();
  const [view, setView] = useState<View>(initialView);
  const [preview, setPreview] = useState<Message[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [admins, setAdmins] = useState<Person[]>([]);
  const ref = useRef<HTMLElement>(null);
  const fechar = useRef(onClose);
  useEffect(() => { fechar.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('.group-close')?.focus({ focusVisible: false } as FocusOptions);
    const solta = registerOverlay(() => fechar.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    window.addEventListener('keydown', onKey);
    return () => { solta(); window.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void fetchMessages('media', 8).then(setPreview);
    void Promise.all([
      supabase.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null).not('file_path', 'is', null),
      supabase.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null).is('file_path', null).or(LINKS),
    ]).then(([files, links]) => setTotal((files.count ?? 0) + (links.count ?? 0)));
    void supabase.from('profiles').select('id, name, avatar_url').eq('role', 'moderator').order('name').then(({ data }) => setAdmins(data ?? []));
  }, [open]);

  if (!open) return null;

  async function share() {
    const url = `${window.location.origin}/comunidade/`;
    try {
      if (navigator.share) await navigator.share({ title: 'Torcida Solar', text: 'Vem torcer com a gente no chat do Desafio Solar Brasil!', url });
      else { await navigator.clipboard.writeText(url); notify('Link do chat copiado.'); }
    } catch { /* a pessoa cancelou o compartilhamento */ }
  }

  const visible = preview.filter(m => !blocked.includes(m.user_id)).slice(0, 4);
  const back = view === 'info' ? onClose : () => setView('info');

  return <aside ref={ref} className="group-info" aria-label={TITLES[view]}>
    <header className="group-info-header">
      <button className="icon-button group-close" onClick={back} aria-label={view === 'info' ? 'Fechar dados do grupo' : 'Voltar'}>
        {view === 'info' ? <><ArrowLeft size={22} className="only-mobile" /><X size={22} className="only-desktop" /></> : <ArrowLeft size={22} />}
      </button>
      <h2>{TITLES[view]}</h2>
    </header>

    <div className="group-info-body">
      {view === 'info' && <>
        <section className="group-hero">
          <img src="/images/logo.png" alt="" />
          <h1>Torcida Solar</h1>
          <p>Grupo · <b>{online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} online` : 'Comunidade DSB'}</b></p>
          <div className="group-actions">
            <button onClick={() => void share()}><span><Share2 size={22} /></span>Compartilhar</button>
            <button onClick={() => setView('media')}><span><Images size={22} /></span>Mídia</button>
            <button onClick={() => setView('rules')}><span><ShieldCheck size={22} /></span>Regras</button>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><span>{theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}</span>{theme === 'dark' ? 'Claro' : 'Escuro'}</button>
          </div>
        </section>
        <p className="group-description">Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
        <hr />

        <button className="group-row" onClick={() => setView('media')}>
          <Images size={22} /><span><strong>Mídia, links e docs</strong></span>
          {total !== null && <em>{total}</em>}<ChevronRight size={20} className="only-mobile" />
        </button>
        {visible.length > 0 && <div className="group-media-preview">
          {visible.map(m => <MediaTile key={m.id} message={m} onOpen={onOpenMedia} />)}
        </div>}
        <hr />

        <button className="group-row" onClick={() => setView('rules')}>
          <ShieldCheck size={22} /><span><strong>Regras do chat</strong><small>Respeito é a nossa principal regra. Boa torcida!</small></span>
        </button>
        <button className="group-row" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Palette size={22} /><span><strong>Tema do chat</strong><small>{theme === 'dark' ? 'Escuro' : 'Claro'}</small></span>
        </button>
        {userId && <button className="group-row" onClick={() => setView('blocked')}>
          <Ban size={22} /><span><strong>Pessoas bloqueadas</strong><small>{blocked.length ? `${blocked.length} ${blocked.length === 1 ? 'pessoa' : 'pessoas'}` : 'Ninguém'}</small></span>
        </button>}
        <Link className="group-row" href="/termos/">
          <FileText size={22} /><span><strong>Termos de uso</strong><small>Ao entrar no chat você aceitou os termos. Toque para ler.</small></span>
        </Link>
        <hr />

        <p className="group-label">Você e a organização</p>
        {userId && profile && <Link className="group-member me" href="/configuracoes/">
          <Avatar id={userId} name={profile.name} url={profile.avatar_url} />
          <span><strong>Você</strong><small className="green">Mudar seu nome no chat</small></span>
          {profile.role === 'moderator' && <i className="admin-badge">Admin do grupo</i>}
        </Link>}
        {admins.filter(a => a.id !== userId).map(admin => <div key={admin.id} className="group-member">
          <Avatar id={admin.id} name={admin.name} url={admin.avatar_url} />
          <span><strong>{shortName(admin.name)}</strong><small>Organização do DSB</small></span>
          <i className="admin-badge">Admin do grupo</i>
        </div>)}

        <Link className="group-row" href="/configuracoes/"><Settings size={22} /><span><strong>Configurações do app</strong></span></Link>
        {userId && <button className="group-row danger" onClick={() => { onClose(); void signOut(); }}><LogOut size={22} /><span><strong>Sair da conta</strong></span></button>}
        <a className="group-row danger" href={`mailto:${contato}?subject=${encodeURIComponent('Denúncia no chat do DSB')}`}><ThumbsDown size={22} /><span><strong>Denunciar um problema</strong></span></a>
        <p className="group-footnote">Grupo criado pela organização do Desafio Solar Brasil.</p>
      </>}

      {view === 'media' && <MediaView blocked={blocked} onOpen={onOpenMedia} />}

      {view === 'rules' && <div className="group-text">
        <p>Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
        <ul>
          <li>Respeite as pessoas e todas as equipes.</li>
          <li>Mantenha a conversa relacionada ao evento.</li>
          <li>Evite spam e a divulgação de informações pessoais.</li>
          <li>Segure uma mensagem (ou passe o mouse e use a setinha) para responder, reagir, denunciar ou bloquear quem estiver incomodando.</li>
        </ul>
        <p>Não há tolerância com ofensa nem com discurso de ódio. Denúncias são analisadas em até 24 horas: a mensagem sai do ar e a conta responsável é banida do chat.</p>
        <p className="group-footnote">Ao entrar você aceitou os <a className="text-link" href="/termos/">termos de uso</a>.</p>
      </div>}

      {view === 'blocked' && (blocked.length
        ? <Blocked ids={blocked} onUnblock={onUnblock} />
        : <p className="group-empty">Ninguém bloqueado. Quem você bloquear aparece aqui, para desbloquear quando quiser.</p>)}
    </div>
  </aside>;
}

function MediaTile({ message, onOpen }: { message: Message; onOpen: (message: Message) => void }) {
  return <button className="media-tile" onClick={() => onOpen(message)} aria-label={`Abrir ${isVideo(message) ? 'vídeo' : 'foto'} de ${shortName(message.author_name)}`}>
    {message.thumb_path ? <img src={chatFileUrl(message.thumb_path)} alt="" loading="lazy" /> : <span />}
    {isVideo(message) && <Play size={18} fill="currentColor" />}
  </button>;
}

/** Galeria do grupo com as abas do WhatsApp: Mídia, Docs e Links. */
function MediaView({ blocked, onOpen }: { blocked: string[]; onOpen: (message: Message) => void }) {
  const [tab, setTab] = useState<'media' | 'docs' | 'links'>('media');
  const [items, setItems] = useState<{ tab: string; list: Message[] } | null>(null);
  useEffect(() => { void fetchMessages(tab, 90).then(list => setItems({ tab, list })); }, [tab]);
  const list = items?.tab === tab ? items.list.filter(m => !blocked.includes(m.user_id)) : null;

  return <>
    <div className="reactor-tabs group-tabs" role="tablist">
      {([['media', 'Mídia'], ['docs', 'Docs'], ['links', 'Links']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {!list ? <p className="group-empty">Carregando…</p>
      : !list.length ? <p className="group-empty">{tab === 'media' ? 'Nenhuma foto ou vídeo ainda.' : tab === 'docs' ? 'Nenhum documento ainda.' : 'Nenhum link ainda.'}</p>
      : tab === 'media' ? <div className="group-media-grid">{list.map(m => <MediaTile key={m.id} message={m} onOpen={onOpen} />)}</div>
      : tab === 'docs' ? list.map(m => <a key={m.id} className="group-row" href={`${chatFileUrl(m.file_path!)}?download=${encodeURIComponent(m.file_name ?? '')}`} target="_blank" rel="noopener noreferrer">
          <FileText size={22} /><span><strong>{m.file_name}</strong><small>{[formatSize(m.file_size), date(m.created_at), shortName(m.author_name)].filter(Boolean).join(' · ')}</small></span>
        </a>)
      : list.map(m => {
          const url = m.body?.match(/(?:https?:\/\/|www\.)[^\s<]+/i)?.[0].replace(/[.,!?;:)\]'"]+$/, '') ?? '';
          return <a key={m.id} className="group-row" href={/^https?:/i.test(url) ? url : `https://${url}`} target="_blank" rel="noopener noreferrer nofollow">
            <Link2 size={22} /><span><strong className="link-url">{url}</strong><small>{shortName(m.author_name)} · {date(m.created_at)}</small></span>
          </a>;
        })}
  </>;
}

function Blocked({ ids, onUnblock }: { ids: string[]; onUnblock: (id: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const key = ids.join();
  useEffect(() => {
    void supabase.from('profiles').select('id, name, avatar_url').in('id', key.split(',')).then(({ data }) => setPeople(data ?? []));
  }, [key]);
  return <div>
    {ids.map(id => {
      const person = people.find(p => p.id === id);
      const name = person ? shortName(person.name) : 'Carregando…';
      return <div key={id} className="group-member">
        <Avatar id={id} name={person?.name ?? '?'} url={person?.avatar_url ?? null} />
        <span><strong>{name}</strong></span>
        <button className="button" onClick={() => onUnblock(id)} aria-label={`Desbloquear ${name}`}>Desbloquear</button>
      </div>;
    })}
  </div>;
}
