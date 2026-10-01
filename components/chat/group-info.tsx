'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Ban, ChevronRight, FileText, Images, Link2, LogOut, Moon, Palette, Play, Settings, Share2, ShieldCheck, Sun, ThumbsDown, X } from 'lucide-react';
import { formatSize } from '@/lib/media';
import { shortName } from '@/lib/names';
import { shareLink } from '@/lib/native-share';
import { registerOverlay } from '@/lib/overlays';
import { supabase } from '@/lib/supabase';
import { useApp } from '../app-shell';
import { useAuth } from '../auth';
import { Avatar } from '../ui';
import { useFileUrl } from './files';
import { AddMembers, GroupDetails } from './groups';
import { isVideo, type Member, type Message, type Person, type Target } from './types';
import { PhotoViewer, type Photo } from './viewer';

type View = 'info' | 'media' | 'rules' | 'blocked' | 'add';

const contato = 'andreoliveiracunha20@gmail.com';
const COLUMNS = 'id, user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, created_at, deleted_at, deleted_by, reply_to, edited_at, conversation_id, duration_ms, waveform, event';
// Valores com ":" e "." vão entre aspas dentro do or() do PostgREST.
const LINKS = 'body.ilike."*http://*",body.ilike."*https://*",body.ilike."*www.*"';
const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Sempre de uma conversa só: o grupo geral (conversation_id nulo), a particular ou o grupo aberto.
function inConversation<Q extends { is: (column: string, value: null) => Q; eq: (column: string, value: string) => Q }>(query: Q, conversationId: string | null) {
  return conversationId ? query.eq('conversation_id', conversationId) : query.is('conversation_id', null);
}

export async function fetchMessages(kind: 'media' | 'docs' | 'links', limit: number, conversationId: string | null) {
  let query = inConversation(supabase.from('messages').select(COLUMNS).is('deleted_at', null).order('id', { ascending: false }).limit(limit), conversationId);
  if (kind === 'media') query = query.not('file_path', 'is', null).or('file_type.like.image/*,file_type.like.video/*');
  if (kind === 'docs') query = query.not('file_path', 'is', null).not('file_type', 'like', 'image/*').not('file_type', 'like', 'video/*').not('file_type', 'like', 'audio/*');
  if (kind === 'links') query = query.or(LINKS);
  const { data } = await query;
  return (data ?? []).map(row => ({ ...row, mentions: [], reactions: [], reply: null })) as Message[];
}

/**
 * Dados do grupo ou do contato, no formato do WhatsApp: tela cheia no celular, painel à direita no desktop.
 * Cada linha faz algo de verdade no app (mídia, regras, tema, bloqueio, termos).
 * members: participantes do grupo criado pelas pessoas (nulo enquanto carrega ou fora de um grupo).
 */
export function InfoPanel({ target, open, initialView, online, contactOnline, blocked, members, onUnblock, onBlock, onOpenMedia, onOpenPerson, onLeft, onMembersChanged, onClose }: {
  target: Target; open: boolean; initialView: View; online: number; contactOnline: boolean; blocked: string[]; members: Member[] | null;
  onUnblock: (id: string) => void; onBlock: (person: Person) => void; onOpenMedia: (message: Message) => void;
  onOpenPerson: (person: Person) => void; onLeft: () => void; onMembersChanged: () => void; onClose: () => void;
}) {
  const { theme, setTheme, notify } = useApp();
  const { userId, profile, signOut } = useAuth();
  const [view, setView] = useState<View>(initialView);
  const [preview, setPreview] = useState<Message[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [admins, setAdmins] = useState<Person[]>([]);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const ref = useRef<HTMLElement>(null);
  const fechar = useRef(onClose);
  const conversationId = target.kind === 'general' ? null : target.id;
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
    void fetchMessages('media', 8, conversationId).then(setPreview);
    const count = () => inConversation(supabase.from('messages').select('id', { count: 'exact', head: true }).is('deleted_at', null), conversationId);
    void Promise.all([count().not('file_path', 'is', null), count().is('file_path', null).or(LINKS)])
      .then(([files, links]) => setTotal((files.count ?? 0) + (links.count ?? 0)));
    if (!conversationId) void supabase.from('profiles').select('id, name, avatar_url').eq('role', 'moderator').order('name').then(({ data }) => setAdmins(data ?? []));
  }, [open, conversationId]);

  if (!open) return null;

  async function share() {
    const url = `${window.location.origin}/comunidade/`;
    const shared = await shareLink({ title: 'Torcida Solar', text: 'Vem torcer com a gente no chat do Desafio Solar Brasil!', url });
    if (!shared) { await navigator.clipboard.writeText(url).catch(() => {}); notify('Link do chat copiado.'); }
  }

  const person = target.kind === 'direct' ? target.other : null;
  const personBlocked = !!person && blocked.includes(person.id);
  const visible = preview.filter(m => !blocked.includes(m.user_id) || !!person).slice(0, 4);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const titles: Record<View, string> = { info: person ? 'Dados do contato' : 'Dados do grupo', media: 'Mídia, links e docs', rules: 'Regras do chat', blocked: 'Pessoas bloqueadas', add: 'Adicionar participantes' };
  const back = view === 'info' ? onClose : () => setView('info');

  const mediaRow = <>
    <button className="group-row" onClick={() => setView('media')}>
      <Images size={22} /><span><strong>Mídia, links e docs</strong></span>
      {total !== null && <em>{total}</em>}<ChevronRight size={20} className="only-mobile" />
    </button>
    {visible.length > 0 && <div className="group-media-preview">
      {visible.map(m => <MediaTile key={m.id} message={m} onOpen={onOpenMedia} />)}
    </div>}
  </>;

  return <aside ref={ref} className="group-info" aria-label={titles[view]}>
    <header className="group-info-header">
      <button className="icon-button group-close" onClick={back} aria-label={view === 'info' ? 'Fechar' : 'Voltar'}>
        {view === 'info' ? <><ArrowLeft size={22} className="only-mobile" /><X size={22} className="only-desktop" /></> : <ArrowLeft size={22} />}
      </button>
      <h2>{titles[view]}</h2>
    </header>

    <div className="group-info-body">
      {view === 'info' && person && <>
        <section className="group-hero">
          <PhotoButton person={person} onOpen={setPhoto} />
          <h1>{person.name}</h1>
          <p>{contactOnline ? <b>online</b> : 'Contato no DSB'}</p>
          <div className="group-actions">
            <button onClick={() => setView('media')}><span><Images size={22} /></span>Mídia</button>
            <button onClick={toggleTheme}><span>{theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}</span>{theme === 'dark' ? 'Claro' : 'Escuro'}</button>
          </div>
        </section>
        <hr />
        {mediaRow}
        <hr />
        <button className="group-row" onClick={toggleTheme}>
          <Palette size={22} /><span><strong>Tema do chat</strong><small>{theme === 'dark' ? 'Escuro' : 'Claro'}</small></span>
        </button>
        <div className="group-row static">
          <ShieldCheck size={22} /><span><strong>Conversa particular</strong><small>Só você e {shortName(person.name)} veem estas mensagens. Denúncias são analisadas pela organização.</small></span>
        </div>
        <hr />
        <button className="group-row danger" onClick={() => personBlocked ? onUnblock(person.id) : onBlock(person)}>
          <Ban size={22} /><span><strong>{personBlocked ? 'Desbloquear' : 'Bloquear'} {shortName(person.name)}</strong></span>
        </button>
        <a className="group-row danger" href={`mailto:${contato}?subject=${encodeURIComponent(`Denúncia de ${person.name} no chat do DSB`)}`}>
          <ThumbsDown size={22} /><span><strong>Denunciar {shortName(person.name)}</strong></span>
        </a>
      </>}

      {view === 'info' && target.kind === 'group' && <GroupDetails id={target.id} group={target.group} members={members} mediaRow={mediaRow}
        onPhoto={setPhoto} onAdd={() => setView('add')} onMedia={() => setView('media')} onChanged={onMembersChanged}
        onOpenPerson={p => { onClose(); onOpenPerson(p); }} onLeft={() => { onClose(); onLeft(); }} />}

      {view === 'add' && target.kind === 'group' && members && <AddMembers id={target.id} members={members} blocked={blocked}
        onDone={() => { onMembersChanged(); setView('info'); }} />}

      {view === 'info' && target.kind === 'general' && <>
        <section className="group-hero">
          <button className="hero-photo" onClick={() => setPhoto({ id: 'grupo', name: 'Torcida Solar', url: '/images/logo.png', subtitle: 'Foto do grupo' })} aria-label="Ver a foto do grupo">
            <img src="/images/logo.png" alt="" />
          </button>
          <h1>Torcida Solar</h1>
          <p>Grupo · <b>{online > 0 ? `${online} ${online === 1 ? 'pessoa' : 'pessoas'} online` : 'Comunidade DSB'}</b></p>
          <div className="group-actions">
            <button onClick={() => void share()}><span><Share2 size={22} /></span>Compartilhar</button>
            <button onClick={() => setView('media')}><span><Images size={22} /></span>Mídia</button>
            <button onClick={() => setView('rules')}><span><ShieldCheck size={22} /></span>Regras</button>
            <button onClick={toggleTheme}><span>{theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}</span>{theme === 'dark' ? 'Claro' : 'Escuro'}</button>
          </div>
        </section>
        <p className="group-description">Este é o espaço para torcer, trocar ideias e acompanhar os bastidores do Desafio Solar Brasil.</p>
        <hr />
        {mediaRow}
        <hr />
        <button className="group-row" onClick={() => setView('rules')}>
          <ShieldCheck size={22} /><span><strong>Regras do chat</strong><small>Respeito é a nossa principal regra. Boa torcida!</small></span>
        </button>
        <button className="group-row" onClick={toggleTheme}>
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
          <PhotoButton person={admin} onOpen={setPhoto} />
          <span><strong>{shortName(admin.name)}</strong><small>Organização do DSB</small></span>
          <i className="admin-badge">Admin do grupo</i>
        </div>)}

        <Link className="group-row" href="/configuracoes/"><Settings size={22} /><span><strong>Configurações do app</strong></span></Link>
        {userId && <button className="group-row danger" onClick={() => { onClose(); void signOut(); }}><LogOut size={22} /><span><strong>Sair da conta</strong></span></button>}
        <a className="group-row danger" href={`mailto:${contato}?subject=${encodeURIComponent('Denúncia no chat do DSB')}`}><ThumbsDown size={22} /><span><strong>Denunciar um problema</strong></span></a>
        <p className="group-footnote">Grupo criado pela organização do Desafio Solar Brasil.</p>
      </>}

      {view === 'media' && <MediaView blocked={person ? [] : blocked} conversationId={conversationId} onOpen={onOpenMedia} />}

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
    <PhotoViewer photo={photo} onClose={() => setPhoto(null)} />
  </aside>;
}

/** Foto que amplia ao tocar. Sem foto (só as iniciais) não há o que ampliar. */
function PhotoButton({ person, onOpen }: { person: Person; onOpen: (photo: Photo) => void }) {
  const avatar = <Avatar id={person.id} name={person.name} url={person.avatar_url} />;
  if (!person.avatar_url) return avatar;
  const url = person.avatar_url;
  return <button className="hero-photo" onClick={() => onOpen({ id: person.id, name: person.name, url })} aria-label={`Ver a foto de ${shortName(person.name)}`}>{avatar}</button>;
}

function MediaTile({ message, onOpen }: { message: Message; onOpen: (message: Message) => void }) {
  const thumb = useFileUrl(message.conversation_id, message.thumb_path);
  return <button className="media-tile" onClick={() => onOpen(message)} aria-label={`Abrir ${isVideo(message) ? 'vídeo' : 'foto'} de ${shortName(message.author_name)}`}>
    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span />}
    {isVideo(message) && <Play size={18} fill="currentColor" />}
  </button>;
}

function DocRow({ message }: { message: Message }) {
  const href = useFileUrl(message.conversation_id, message.file_path, message.file_name ?? 'arquivo');
  return <a className="group-row" href={href ?? undefined} target="_blank" rel="noopener noreferrer">
    <FileText size={22} /><span><strong>{message.file_name}</strong><small>{[formatSize(message.file_size), date(message.created_at), shortName(message.author_name)].filter(Boolean).join(' · ')}</small></span>
  </a>;
}

/** Galeria com as abas do WhatsApp: Mídia, Docs e Links. */
function MediaView({ blocked, conversationId, onOpen }: { blocked: string[]; conversationId: string | null; onOpen: (message: Message) => void }) {
  const [tab, setTab] = useState<'media' | 'docs' | 'links'>('media');
  const [items, setItems] = useState<{ tab: string; list: Message[] } | null>(null);
  useEffect(() => { void fetchMessages(tab, 90, conversationId).then(list => setItems({ tab, list })); }, [tab, conversationId]);
  const list = items?.tab === tab ? items.list.filter(m => !blocked.includes(m.user_id)) : null;

  return <>
    <div className="reactor-tabs group-tabs" role="tablist">
      {([['media', 'Mídia'], ['docs', 'Docs'], ['links', 'Links']] as const).map(([id, label]) =>
        <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {!list ? <p className="group-empty">Carregando…</p>
      : !list.length ? <p className="group-empty">{tab === 'media' ? 'Nenhuma foto ou vídeo ainda.' : tab === 'docs' ? 'Nenhum documento ainda.' : 'Nenhum link ainda.'}</p>
      : tab === 'media' ? <div className="group-media-grid">{list.map(m => <MediaTile key={m.id} message={m} onOpen={onOpen} />)}</div>
      : tab === 'docs' ? list.map(m => <DocRow key={m.id} message={m} />)
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
