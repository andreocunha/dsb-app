'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight, Images, LogOut, MessageCircle, Moon, Pencil, Search, ShieldCheck, ShieldOff, Sun, ThumbsDown, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { makeThumbnail } from '@/lib/media';
import { shortName } from '@/lib/names';
import { supabase, errorMessage } from '@/lib/supabase';
import { useApp, useOnlineUsers } from '../app-shell';
import { useAuth } from '../auth';
import { Avatar, Sheet } from '../ui';
import { useFileUrl } from './files';
import { usePeople } from './mentions';
import { MAX_GROUP, type GroupInfo, type Member, type Person } from './types';
import type { Photo } from './viewer';

const MAX_NAME = 100;
const MAX_DESCRIPTION = 512;
const contato = 'andreoliveiracunha20@gmail.com';
const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Foto do grupo (link assinado, bucket privado). Sem foto, o ícone de pessoas do WhatsApp. */
export function GroupAvatar({ id, group, className = '' }: { id: string; group: Pick<GroupInfo, 'photo_path'>; className?: string }) {
  const url = useFileUrl(id, group.photo_path);
  return url ? <img className={`avatar ${className}`} src={url} alt="" loading="lazy" />
    : <span className={`avatar group-avatar ${className}`} aria-hidden><Users /></span>;
}

/** Participantes do grupo aberto, admins primeiro. reload: depois de alguém entrar, sair ou virar admin. */
export function useGroupMembers(conversationId: string | null) {
  const [members, setMembers] = useState<{ id: string; list: Member[] } | null>(null);
  const reload = useCallback(() => {
    if (!conversationId) return;
    void supabase.rpc('group_members', { p_conversation: conversationId }).then(({ data, error }) => {
      if (error) return;
      setMembers({ id: conversationId, list: (data ?? []).map(m => ({ id: m.user_id, name: m.name, avatar_url: m.avatar_url, admin: m.admin })) });
    });
  }, [conversationId]);
  useEffect(reload, [reload]);
  return { members: members && members.id === conversationId ? members.list : null, reload };
}

/** A foto vai reduzida (como as miniaturas do chat) para a pasta da pessoa dentro do grupo, no bucket privado. */
export async function uploadGroupPhoto(conversationId: string, userId: string, file: File) {
  const thumb = await makeThumbnail(file);
  if (!thumb) throw new Error('Não foi possível usar esta imagem. Escolha uma foto.');
  const path = `${conversationId}/${userId}/foto-${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('dm').upload(path, thumb.blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  const { error: rpcError } = await supabase.rpc('set_group_photo', { p_conversation: conversationId, p_path: path });
  if (rpcError) { void supabase.storage.from('dm').remove([path]); throw rpcError; }
  return path;
}

/**
 * Escolher várias pessoas, como o "Adicionar participantes" do WhatsApp: as escolhidas viram
 * fichinhas no topo (toque tira), a busca filtra a lista e as letras separam os nomes.
 * exclude: quem não pode aparecer (você, quem já está no grupo, quem você bloqueou).
 */
export function PeoplePicker({ selected, onChange, exclude, max }: {
  selected: Person[]; onChange: (people: Person[]) => void; exclude: string[]; max: number;
}) {
  const [query, setQuery] = useState('');
  const people = usePeople(true);
  const onlineUsers = useOnlineUsers();
  const { notify } = useApp();
  const chips = useRef<HTMLDivElement>(null);
  const term = normalize(query.trim());
  const list = people.filter(p => !exclude.includes(p.id) && (!term || normalize(p.name).includes(term)));
  const isOn = (id: string) => selected.some(p => p.id === id);
  const letters: { letter: string; list: Person[] }[] = [];
  for (const person of list) {
    const letter = normalize(person.name.trim()[0] ?? '#').toUpperCase().replace(/[^A-Z]/, '#');
    const last = letters[letters.length - 1];
    if (last?.letter === letter) last.list.push(person); else letters.push({ letter, list: [person] });
  }

  function toggle(person: Person) {
    if (isOn(person.id)) { onChange(selected.filter(p => p.id !== person.id)); return; }
    if (selected.length >= max) { notify(`Um grupo pode ter até ${MAX_GROUP} participantes.`); return; }
    onChange([...selected, person]);
    setQuery('');
  }

  // A fichinha nova aparece no fim da fila: rola até ela.
  useEffect(() => { chips.current?.scrollTo({ left: chips.current.scrollWidth }); }, [selected.length]);

  return <>
    {selected.length > 0 && <div className="picked" ref={chips}>
      {selected.map(person => <button key={person.id} className="picked-chip" onClick={() => toggle(person)} aria-label={`Tirar ${shortName(person.name)}`}>
        <span className="picked-photo"><Avatar id={person.id} name={person.name} url={person.avatar_url} small /><X size={12} /></span>
        <small>{shortName(person.name).split(' ')[0]}</small>
      </button>)}
    </div>}
    <label className="chats-search">
      <Search size={18} />
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar nome" aria-label="Pesquisar pessoas" autoFocus />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar pesquisa"><X size={18} /></button>}
    </label>
    <div className="chats-scroll picker-list">
      {!people.length ? <p className="chats-empty"><span className="spinner" /></p>
        : !list.length ? <p className="chats-empty">Ninguém encontrado com esse nome.</p>
        : letters.map(group => <div key={group.letter}>
          <p className="chats-letter">{group.letter}</p>
          {group.list.map(person => <button key={person.id} className={`chat-row person ${isOn(person.id) ? 'on' : ''}`} onClick={() => toggle(person)}
            role="checkbox" aria-checked={isOn(person.id)}>
            <span className="chat-row-avatar-wrap">
              <Avatar id={person.id} name={person.name} url={person.avatar_url} />
              {isOn(person.id) && <span className="picked-check"><Check size={13} strokeWidth={3} /></span>}
            </span>
            <span className="chat-row-main"><span className="chat-row-top"><strong>{person.name}</strong></span>
              <span className="chat-row-bottom"><span className="chat-row-preview">{onlineUsers.has(person.id) ? 'online' : 'Contato no DSB'}</span></span></span>
          </button>)}
        </div>)}
    </div>
  </>;
}

/**
 * "Novo grupo", em duas etapas como no WhatsApp: escolher os participantes e depois dar nome e foto.
 * Quem cria vira admin; a foto é enviada logo depois de o grupo existir (o caminho usa o id dele).
 */
export function NewGroup({ blocked, onClose, onCreated }: {
  blocked: string[]; onClose: () => void; onCreated: (id: string, group: GroupInfo) => void;
}) {
  const { userId } = useAuth();
  const { notify } = useApp();
  const [step, setStep] = useState<'people' | 'details'>('people');
  const [selected, setSelected] = useState<Person[]>([]);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) { if (step === 'details') setStep('people'); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, saving, onClose]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Escolha uma imagem para a foto do grupo.'); return; }
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  async function create() {
    const clean = name.trim();
    if (!clean || !userId || saving) return;
    setSaving(true);
    const { data: id, error } = await supabase.rpc('create_group', { p_name: clean, p_members: selected.map(p => p.id) });
    if (error || !id) { setSaving(false); notify(errorMessage(error)); return; }
    let photoPath: string | null = null;
    if (photo) {
      try { photoPath = await uploadGroupPhoto(id, userId, photo.file); }
      catch (e) { notify(`O grupo foi criado, mas a foto não foi enviada: ${errorMessage(e)}`); }
    }
    onCreated(id, { name: clean.replace(/\s+/g, ' '), photo_path: photoPath, description: null });
  }

  if (step === 'people') return <>
    <header className="chats-header sub">
      <button className="icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={22} /></button>
      <h2>Adicionar participantes<small>{selected.length ? `${selected.length} de ${MAX_GROUP - 1} selecionados` : 'Escolha quem vai entrar no grupo'}</small></h2>
    </header>
    <PeoplePicker selected={selected} onChange={setSelected} exclude={[...(userId ? [userId] : []), ...blocked]} max={MAX_GROUP - 1} />
    {selected.length > 0 && <button className="new-chat-fab" onClick={() => setStep('details')} aria-label="Avançar"><ArrowRight size={24} /></button>}
  </>;

  return <>
    <header className="chats-header sub">
      <button className="icon-button" onClick={() => setStep('people')} disabled={saving} aria-label="Voltar"><ArrowLeft size={22} /></button>
      <h2>Novo grupo</h2>
    </header>
    <div className="chats-scroll new-group">
      <div className="new-group-top">
        <button className="new-group-photo" onClick={() => fileInput.current?.click()} aria-label={photo ? 'Trocar a foto do grupo' : 'Escolher a foto do grupo'}>
          {photo ? <img src={photo.url} alt="" /> : <><Camera size={26} /><small>Adicionar foto</small></>}
        </button>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <label className="new-group-name">
          <input value={name} onChange={e => setName(e.target.value.slice(0, MAX_NAME))} placeholder="Nome do grupo" aria-label="Nome do grupo"
            maxLength={MAX_NAME} autoFocus onKeyDown={e => { if (e.key === 'Enter') void create(); }} />
          <small>{MAX_NAME - name.length}</small>
        </label>
      </div>
      <p className="chats-label">Participantes: {selected.length + 1}</p>
      <div className="new-group-people">
        {selected.map(person => <span key={person.id}>
          <Avatar id={person.id} name={person.name} url={person.avatar_url} />
          <small>{shortName(person.name).split(' ')[0]}</small>
        </span>)}
      </div>
    </div>
    <button className="new-chat-fab" onClick={() => void create()} disabled={!name.trim() || saving} aria-label="Criar grupo">
      {saving ? <span className="spinner" /> : <Check size={26} />}
    </button>
  </>;
}

type Confirm = { title: string; text: string; label: string; run: () => void };

/**
 * Dados de um grupo criado pelas pessoas, como no WhatsApp: foto, nome, descrição, participantes
 * com os admins marcados, e as ações de admin (adicionar, remover, promover, editar).
 * mediaRow: a linha "Mídia, links e docs" do painel, igual à das outras conversas.
 */
export function GroupDetails({ id, group, members, mediaRow, onPhoto, onAdd, onMedia, onOpenPerson, onLeft, onChanged }: {
  id: string; group: GroupInfo; members: Member[] | null; mediaRow: React.ReactNode;
  onPhoto: (photo: Photo) => void; onAdd: () => void; onMedia: () => void; onOpenPerson: (person: Person) => void;
  onLeft: () => void; onChanged: () => void;
}) {
  const { userId } = useAuth();
  const { theme, setTheme, notify } = useApp();
  const onlineUsers = useOnlineUsers();
  const [member, setMember] = useState<Member | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoUrl = useFileUrl(id, group.photo_path);
  const amAdmin = !!members?.some(m => m.id === userId && m.admin);
  const count = members?.length ?? 0;
  const me = members?.find(m => m.id === userId);
  const others = members?.filter(m => m.id !== userId) ?? [];

  async function run(action: PromiseLike<{ error: unknown }>, done?: string) {
    const { error } = await action;
    if (error) { notify(errorMessage(error)); return false; }
    if (done) notify(done);
    onChanged();
    return true;
  }

  async function changePhoto(file: File | undefined) {
    if (!file || !userId) return;
    if (!file.type.startsWith('image/')) { notify('Escolha uma imagem para a foto do grupo.'); return; }
    setUploading(true);
    try { await uploadGroupPhoto(id, userId, file); notify('Foto do grupo atualizada.'); }
    catch (e) { notify(errorMessage(e)); }
    setUploading(false);
  }

  function memberAction(target: Member, action: 'chat' | 'admin' | 'remove') {
    setMember(null);
    const name = shortName(target.name);
    if (action === 'chat') onOpenPerson(target);
    if (action === 'admin') void run(supabase.rpc('set_group_admin', { p_conversation: id, p_user: target.id, p_admin: !target.admin }),
      target.admin ? `${name} não é mais admin do grupo.` : `${name} agora é admin do grupo.`);
    if (action === 'remove') setConfirm({
      title: `Remover ${name}?`, text: `${name} sai do grupo e deixa de ver as mensagens novas.`, label: 'Remover',
      run: () => void run(supabase.rpc('remove_group_member', { p_conversation: id, p_user: target.id })),
    });
  }

  function askLeave() {
    setConfirm({
      title: `Sair do grupo "${group.name}"?`,
      text: count <= 1 ? 'Você é a última pessoa do grupo: ao sair, ele e as mensagens são apagados.'
        : amAdmin && !others.some(m => m.admin) ? 'Você é o único admin: outra pessoa do grupo vira admin quando você sair.'
        : 'Você deixa de receber as mensagens deste grupo. Para voltar, um admin precisa adicionar você.',
      label: 'Sair do grupo',
      run: async () => { if (await run(supabase.rpc('leave_group', { p_conversation: id }))) onLeft(); },
    });
  }

  const memberRow = (m: Member) => {
    const mine = m.id === userId;
    const content = <>
      <Avatar id={m.id} name={m.name} url={m.avatar_url} />
      <span><strong>{mine ? 'Você' : m.name}</strong><small>{onlineUsers.has(m.id) && !mine ? 'online' : 'Contato no DSB'}</small></span>
      {m.admin && <i className="admin-badge">Admin do grupo</i>}
    </>;
    return mine ? <div key={m.id} className="group-member">{content}</div>
      : <button key={m.id} className="group-member" onClick={() => setMember(m)} aria-label={`Opções de ${shortName(m.name)}`}>{content}</button>;
  };

  return <>
    <section className="group-hero">
      <span className="hero-photo-wrap">
        {photoUrl ? <button className="hero-photo" onClick={() => onPhoto({ id, name: group.name, url: photoUrl, subtitle: 'Foto do grupo' })} aria-label="Ver a foto do grupo">
          <img src={photoUrl} alt="" />
        </button> : <GroupAvatar id={id} group={group} />}
        {amAdmin && <button className="hero-photo-edit" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label="Mudar a foto do grupo">
          {uploading ? <span className="spinner" /> : <Camera size={18} />}
        </button>}
      </span>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { void changePhoto(e.target.files?.[0]); e.target.value = ''; }} />
      <h1 className="group-name">{group.name}{amAdmin && <button className="icon-button" onClick={() => setEditing(true)} aria-label="Editar nome e descrição"><Pencil size={18} /></button>}</h1>
      <p>Grupo · {members ? `${count} ${count === 1 ? 'participante' : 'participantes'}` : '…'}</p>
      <div className="group-actions">
        {amAdmin && <button onClick={onAdd}><span><UserPlus size={22} /></span>Adicionar</button>}
        <button onClick={onMedia}><span><Images size={22} /></span>Mídia</button>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><span>{theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}</span>{theme === 'dark' ? 'Claro' : 'Escuro'}</button>
      </div>
    </section>
    {group.description ? <button className="group-description editable" onClick={() => amAdmin && setEditing(true)} disabled={!amAdmin}>{group.description}</button>
      : amAdmin && <button className="group-row" onClick={() => setEditing(true)}><Pencil size={22} /><span><strong className="green">Adicionar descrição do grupo</strong></span></button>}
    <hr />
    {mediaRow}
    <hr />
    <p className="group-label">{members ? `${count} ${count === 1 ? 'participante' : 'participantes'}` : 'Participantes'}</p>
    {amAdmin && <button className="group-row" onClick={onAdd}>
      <span className="round-icon"><UserPlus size={20} /></span><span><strong>Adicionar participantes</strong></span><ChevronRight size={20} className="only-mobile" />
    </button>}
    {!members ? <p className="group-empty"><span className="spinner" /></p> : <>
      {me && memberRow(me)}
      {others.map(memberRow)}
    </>}
    <hr />
    {me && <button className="group-row danger" onClick={askLeave}><LogOut size={22} /><span><strong>Sair do grupo</strong></span></button>}
    <a className="group-row danger" href={`mailto:${contato}?subject=${encodeURIComponent(`Denúncia do grupo "${group.name}" no chat do DSB`)}`}>
      <ThumbsDown size={22} /><span><strong>Denunciar grupo</strong></span>
    </a>

    <Sheet open={!!member} onClose={() => setMember(null)} title={member ? shortName(member.name) : ''} subtitle={member?.admin ? 'Admin do grupo' : undefined}>
      {member && <div className="sheet-menu">
        <button className="group-row" onClick={() => memberAction(member, 'chat')}><MessageCircle size={22} /><span><strong>Conversar com {shortName(member.name)}</strong></span></button>
        {amAdmin && <>
          <button className="group-row" onClick={() => memberAction(member, 'admin')}>
            {member.admin ? <ShieldOff size={22} /> : <ShieldCheck size={22} />}<span><strong>{member.admin ? 'Remover como admin' : 'Promover a admin do grupo'}</strong></span>
          </button>
          <button className="group-row danger" onClick={() => memberAction(member, 'remove')}><UserMinus size={22} /><span><strong>Remover {shortName(member.name)}</strong></span></button>
        </>}
      </div>}
    </Sheet>
    <EditGroup key={editing ? 'aberto' : 'fechado'} open={editing} group={group} onClose={() => setEditing(false)}
      onSave={async (name, description) => {
        if (await run(supabase.rpc('update_group', { p_conversation: id, p_name: name, p_description: description }))) setEditing(false);
      }}
      onRemovePhoto={group.photo_path ? async () => {
        if (await run(supabase.rpc('set_group_photo', { p_conversation: id, p_path: null }), 'Foto do grupo removida.')) setEditing(false);
      } : undefined} />
    <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''}>
      {confirm && <div className="confirm">
        <p>{confirm.text}</p>
        <div><button className="button" onClick={() => setConfirm(null)}>Cancelar</button>
          <button className="button danger-solid" onClick={() => { setConfirm(null); confirm.run(); }}>{confirm.label}</button></div>
      </div>}
    </Sheet>
  </>;
}

function EditGroup({ open, group, onClose, onSave, onRemovePhoto }: {
  open: boolean; group: GroupInfo; onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>; onRemovePhoto?: () => Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    await onSave(name.trim(), description.trim());
    setSaving(false);
  }
  return <Sheet open={open} onClose={onClose} title="Dados do grupo">
    <form className="edit-group" onSubmit={e => void save(e)}>
      <label><span>Nome do grupo</span>
        <input value={name} onChange={e => setName(e.target.value.slice(0, MAX_NAME))} maxLength={MAX_NAME} required />
        <small>{MAX_NAME - name.length}</small></label>
      <label><span>Descrição</span>
        <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))} maxLength={MAX_DESCRIPTION} rows={4}
          placeholder="Do que o grupo trata, regras, links…" />
        <small>{MAX_DESCRIPTION - description.length}</small></label>
      <div className="confirm">
        <div>
          {onRemovePhoto && <button type="button" className="button" onClick={() => void onRemovePhoto()} disabled={saving}>Remover foto</button>}
          <button type="submit" className="button primary" disabled={!name.trim() || saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </form>
  </Sheet>;
}

/** "Adicionar participantes" dentro dos dados do grupo (só admins). */
export function AddMembers({ id, members, blocked, onDone }: { id: string; members: Member[]; blocked: string[]; onDone: (added: boolean) => void }) {
  const { notify } = useApp();
  const [selected, setSelected] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  async function add() {
    setSaving(true);
    const { data, error } = await supabase.rpc('add_group_members', { p_conversation: id, p_users: selected.map(p => p.id) });
    setSaving(false);
    if (error) { notify(errorMessage(error)); return; }
    if (data !== selected.length) notify(`${data} de ${selected.length} pessoas foram adicionadas. As outras não podem entrar no grupo.`);
    onDone(true);
  }
  return <div className="add-members">
    <PeoplePicker selected={selected} onChange={setSelected} exclude={[...members.map(m => m.id), ...blocked]} max={MAX_GROUP - members.length} />
    {selected.length > 0 && <button className="new-chat-fab" onClick={() => void add()} disabled={saving} aria-label={`Adicionar ${selected.length} ${selected.length === 1 ? 'pessoa' : 'pessoas'}`}>
      {saving ? <span className="spinner" /> : <Check size={26} />}
    </button>}
  </div>;
}
