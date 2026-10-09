'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, Check, ChevronRight, ChevronsUpDown, Eye, ImagePlus, LogIn, LogOut, Moon, Search, ShieldCheck, Sun, Trash2, Users } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useApp } from './app-shell';
import { useAuth, type Affiliation, type Profile } from './auth';
import { PhotoCrop } from './photo-crop';
import { forgetAffiliations } from './chat/affiliations';
import { Avatar, Sheet, TeamBadge } from './ui';
import { supabase, errorMessage } from '@/lib/supabase';
import type { Team } from '@/lib/data';

type TeamOption = Pick<Team, 'id' | 'name' | 'initials' | 'color' | 'logo'> & { active: boolean };
type Link = { affiliation: Affiliation | null; team_id: string | null; team_status: 'member' | 'alumni' };
type ChatFilter = 'all' | 'mentions' | 'off';
type Prefs = { chat: ChatFilter; fantasy: boolean; announcements: boolean };
const DEFAULT_PREFS: Prefs = { chat: 'mentions', fantasy: true, announcements: true };

const AFFILIATIONS: { id: Affiliation; title: string; text: string; icon: typeof Users }[] = [
  { id: 'team', title: 'Equipe', text: 'Faço ou já fiz parte de um barco', icon: Users },
  { id: 'organization', title: 'Organização', text: 'Trabalho na organização do evento', icon: ShieldCheck },
  { id: 'visitor', title: 'Visitante', text: 'Estou acompanhando e torcendo', icon: Eye },
];
const CHAT_FILTERS: { id: ChatFilter; label: string; text: string }[] = [
  { id: 'all', label: 'Todas', text: 'Toda mensagem nova, inclusive cada mensagem da Torcida Solar.' },
  { id: 'mentions', label: 'Menções', text: 'Conversas e grupos normalmente. Na Torcida Solar, só quando marcarem ou responderem você.' },
  { id: 'off', label: 'Nenhuma', text: 'Nenhuma notificação do chat. As mensagens continuam chegando no app.' },
];

const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const noopSubscribe = () => () => {};
const linkOf = (profile: Profile | null): Link =>
  ({ affiliation: profile?.affiliation ?? null, team_id: profile?.team_id ?? null, team_status: profile?.team_status ?? 'member' });

/** Equipes para o vínculo: as desta edição e, para ex-membros, as de edições anteriores. */
function useTeamOptions() {
  const [teams, setTeams] = useState<TeamOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    // Jet ski de resgate e barco de apoio (rastreio) não são equipes.
    void supabase.from('teams').select('id, name, initials, color, logo, active').in('boat_hull', ['cat', 'mono']).order('name')
      .then(({ data }) => { if (alive) setTeams((data ?? []) as TeamOption[]); });
    return () => { alive = false; };
  }, []);
  return teams;
}

/** Filtros de notificação da conta (sem linha no banco = padrão). */
function usePrefs(userId: string | null) {
  const [loaded, setLoaded] = useState<{ user: string; prefs: Prefs } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void supabase.from('notification_prefs').select('chat, fantasy, announcements').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setLoaded({ user: userId, prefs: (data as Prefs | null) ?? DEFAULT_PREFS }); });
    return () => { alive = false; };
  }, [userId]);
  const prefs = loaded?.user === userId ? loaded.prefs : null;
  const set = (prefs: Prefs) => { if (userId) setLoaded({ user: userId, prefs }); };
  return [prefs, set] as const;
}

export function Preferences() {
  const { theme, setTheme, notify } = useApp();
  const { userId, profile, requireLogin, signOut, reloadProfile } = useAuth();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const nameValue = draft ?? profile?.name ?? '';
  const nameChanged = draft !== null && draft.trim() !== '' && draft.trim() !== profile?.name;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const name = nameValue.trim();
    if (!name || !nameChanged) return;
    const { error } = await supabase.rpc('update_profile', { p_name: name });
    if (error) { notify(errorMessage(error)); return; }
    await reloadProfile();
    setDraft(null);
    notify('Seu nome foi atualizado.');
  }

  async function removeFolder(bucket: string, folder: string) {
    const files = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
    const paths = (files.data ?? []).map(f => `${folder}/${f.name}`);
    if (paths.length) await supabase.storage.from(bucket).remove(paths);
  }

  async function deleteAccount() {
    setBusy(true);
    // Remove os arquivos enviados no chat e a foto do perfil antes de apagar a conta.
    const folders = await supabase.storage.from('chat').list(userId!, { limit: 1000 });
    for (const folder of folders.data ?? []) await removeFolder('chat', `${userId}/${folder.name}`);
    await removeFolder('avatars', userId!);
    const { error } = await supabase.rpc('delete_account');
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    setConfirmDelete(false);
    await signOut();
    notify('Sua conta e seus dados foram excluídos.');
  }

  return <div className="page settings">
    <div className="page-heading"><div><h1>Configurações</h1><p>Seu perfil, vínculo com o DSB e notificações.</p></div></div>

    {userId ? <>
      <section className="settings-group" aria-labelledby="settings-profile">
        <h2 id="settings-profile" className="settings-label">Perfil</h2>
        <div className="settings-card">
          <ProfilePhoto userId={userId} profile={profile} onChanged={reloadProfile} />
          <form className="settings-row name-field" onSubmit={e => void saveName(e)}>
            <label htmlFor="display-name">Nome no chat e no ranking</label>
            <div>
              <input id="display-name" required maxLength={40} autoComplete="name" value={nameValue} onChange={e => setDraft(e.target.value)} />
              <button className="button primary" type="submit" disabled={!nameChanged}><Check size={16} /> Salvar</button>
            </div>
          </form>
        </div>
      </section>

      <AffiliationSettings profile={profile} onChanged={reloadProfile} />
      <NotificationSettings userId={userId} />
    </> : <section className="settings-group">
      <div className="settings-card settings-signin">
        <span className="settings-signin-icon"><LogIn size={20} /></span>
        <div>
          <h2>Entre para personalizar</h2>
          <p>Com uma conta você troca a foto, escolhe sua equipe e decide quais notificações receber.</p>
        </div>
        <button className="button primary" onClick={() => requireLogin()}><LogIn size={16} /> Entrar</button>
      </div>
    </section>}

    {/* No desktop o tema já fica no rodapé da sidebar; aqui só no celular. */}
    <section className="settings-group settings-appearance" aria-labelledby="settings-theme">
      <h2 id="settings-theme" className="settings-label">Aparência</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="theme-options" role="radiogroup" aria-labelledby="settings-theme">
            {[{ id: 'light', title: 'Claro', icon: Sun }, { id: 'dark', title: 'Escuro', icon: Moon }].map(option =>
              <button key={option.id} role="radio" aria-checked={theme === option.id} onClick={() => setTheme(option.id)}>
                <option.icon size={18} />{option.title}{theme === option.id && <Check size={16} />}
              </button>)}
          </div>
        </div>
      </div>
    </section>

    {userId && <section className="settings-group" aria-labelledby="settings-account">
      <h2 id="settings-account" className="settings-label">Conta</h2>
      <div className="settings-card">
        <button className="settings-row settings-action" onClick={() => void signOut()}><LogOut size={18} /><span>Sair da conta</span><ChevronRight size={18} /></button>
        <button className="settings-row settings-action danger" onClick={() => setConfirmDelete(true)}><Trash2 size={18} /><span>Excluir conta</span><ChevronRight size={18} /></button>
      </div>
    </section>}

    <p className="footnote legal-link">Ao usar o chat e o fantasy você concorda com a nossa <a className="text-link" href="/privacidade/">política de privacidade</a>.</p>
    <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir sua conta?">
      <div className="prose">
        <p>Isso apaga seu perfil, sua foto, suas mensagens, arquivos enviados, reações e escalações do fantasy. <strong>Não dá para desfazer.</strong></p>
        <div className="account-actions">
          <button className="button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
          <button className="button danger-solid" disabled={busy} onClick={() => void deleteAccount()}><Trash2 size={16} /> {busy ? 'Excluindo…' : 'Excluir definitivamente'}</button>
        </div>
      </div>
    </Sheet>
  </div>;
}

// Foto enviada pelo app: o caminho no bucket vem depois deste trecho do link público.
const AVATAR_PATH = '/storage/v1/object/public/avatars/';

function ProfilePhoto({ userId, profile, onChanged }: { userId: string; profile: Profile | null; onChanged: () => Promise<void> }) {
  const { notify } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [menu, setMenu] = useState(false);
  // Remover pede confirmação numa segunda tela: tocar em "Remover foto" sozinho não apaga nada.
  // Confirmar a remoção é uma página do próprio menu, não outro sheet por cima.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  // Foto que veio com o login (Google): dá para voltar para ela a qualquer momento.
  const [account, setAccount] = useState<{ user: string; photo: string | null; google: boolean } | null>(null);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      const photo = (user.user_metadata.avatar_url ?? user.user_metadata.picture ?? null) as string | null;
      setAccount({ user: user.id, photo, google: user.app_metadata.provider === 'google' });
    });
  }, [userId]);
  const current = profile?.avatar_url ?? null;
  const accountPhoto = account?.user === userId ? account.photo : null;
  const canUseAccount = !!accountPhoto && accountPhoto !== current;

  function choose() { setMenu(false); input.current?.click(); }
  // Sem foto e sem foto da conta, o menu só teria "escolher": abre a galeria direto.
  function openMenu() { if (current || canUseAccount) { setConfirmRemove(false); setMenu(true); } else input.current?.click(); }

  function pick(picked: File | undefined) {
    if (!picked) return;
    if (!picked.type.startsWith('image/')) { notify('Escolha uma imagem para a foto do perfil.'); return; }
    setFile(picked);
  }

  /** Troca a foto e oferece "Desfazer" no aviso, voltando para a que estava antes. */
  async function apply(run: () => PromiseLike<{ error: unknown }>, message: string, previous: string | null) {
    setBusy(true);
    const { error } = await run();
    if (error) { notify(errorMessage(error)); setBusy(false); return false; }
    await onChanged();
    setBusy(false);
    notify(message, { label: 'Desfazer', run: () => void restore(previous) });
    return true;
  }

  async function restore(previous: string | null) {
    const path = previous?.includes(AVATAR_PATH) ? decodeURIComponent(previous.split(AVATAR_PATH)[1]) : null;
    const run = !previous ? () => supabase.rpc('update_avatar', { p_path: null })
      : path ? () => supabase.rpc('update_avatar', { p_path: path })
      : previous === accountPhoto ? () => supabase.rpc('use_account_avatar')
      : null;
    if (!run) { notify('Não foi possível voltar para a foto anterior.'); return; }
    setBusy(true);
    const { error } = await run();
    if (error) notify(errorMessage(error)); else { await onChanged(); notify('Foto anterior de volta.'); }
    setBusy(false);
  }

  async function save(blob: Blob) {
    setBusy(true);
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) { notify(errorMessage(error)); setBusy(false); return; }
    const done = await apply(async () => {
      const result = await supabase.rpc('update_avatar', { p_path: path });
      if (result.error) void supabase.storage.from('avatars').remove([path]);
      return result;
    }, 'Foto do perfil atualizada.', current);
    if (!done) return;
    setFile(null);
    // Só a foto anterior fica guardada (para o desfazer); as mais antigas saem do storage.
    const keep = current?.includes(AVATAR_PATH) ? decodeURIComponent(current.split(AVATAR_PATH)[1]) : null;
    const files = await supabase.storage.from('avatars').list(userId, { limit: 1000 });
    const old = (files.data ?? []).map(f => `${userId}/${f.name}`).filter(p => p !== path && p !== keep);
    if (old.length) void supabase.storage.from('avatars').remove(old);
  }

  // Remover não apaga o arquivo: o "Desfazer" do aviso precisa dele. Ele sai na próxima troca de foto.
  const remove = () => { setMenu(false); void apply(() => supabase.rpc('update_avatar', { p_path: null }), 'Foto removida.', current); };
  const useAccount = () => { setMenu(false); void apply(() => supabase.rpc('use_account_avatar'), 'Voltamos para a foto da sua conta.', current); };

  return <div className="settings-row profile-photo">
    <button className="profile-photo-button" onClick={openMenu} disabled={busy} aria-label="Alterar foto do perfil" aria-haspopup="dialog">
      <Avatar id={userId} name={profile?.name ?? ''} url={current} />
      <span className="profile-photo-badge" aria-hidden><Camera size={14} /></span>
    </button>
    <div className="profile-photo-text">
      <h3>Foto do perfil</h3>
      <p>Aparece no chat e no ranking do fantasy.</p>
      <div className="profile-photo-actions">
        <button className="button" onClick={openMenu} disabled={busy} aria-haspopup="dialog"><Camera size={16} /> {busy ? 'Salvando…' : current ? 'Alterar foto' : 'Adicionar foto'}</button>
      </div>
    </div>
    <input ref={input} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    <Sheet open={menu} onClose={() => setMenu(false)} page={confirmRemove ? 'remove' : 'menu'} depth={confirmRemove ? 1 : 0}
      onBack={confirmRemove ? () => setConfirmRemove(false) : undefined} title={confirmRemove ? 'Remover foto do perfil?' : 'Foto do perfil'}>
      {confirmRemove ? <div className="prose">
        <div className="photo-menu-preview"><Avatar id={userId} name={profile?.name ?? ''} url={current} /></div>
        <p>No lugar da foto vão aparecer as iniciais do seu nome, no chat e no ranking do fantasy.</p>
        <div className="account-actions">
          <button className="button" onClick={() => setConfirmRemove(false)}>Cancelar</button>
          <button className="button danger-solid" disabled={busy} onClick={remove}><Trash2 size={16} /> Remover foto</button>
        </div>
      </div> : <>
      <div className="photo-menu-preview"><Avatar id={userId} name={profile?.name ?? ''} url={current} /></div>
      <button className="sheet-row" onClick={choose}><ImagePlus size={20} /><span>Escolher nova foto</span><ChevronRight size={18} /></button>
      {canUseAccount && <button className="sheet-row" onClick={useAccount}>
        <img className="avatar small" src={accountPhoto!} alt="" referrerPolicy="no-referrer" />
        <span>{account?.google ? 'Usar a foto da conta Google' : 'Usar a foto da sua conta'}</span><ChevronRight size={18} />
      </button>}
      {current && <button className="sheet-row danger" onClick={() => setConfirmRemove(true)}><Trash2 size={20} /><span>Remover foto</span></button>}
      </>}
    </Sheet>
    <PhotoCrop file={file} busy={busy} onCancel={() => { if (!busy) setFile(null); }} onConfirm={blob => void save(blob)} />
  </div>;
}

function AffiliationSettings({ profile, onChanged }: { profile: Profile | null; onChanged: () => Promise<void> }) {
  const { notify } = useApp();
  const teams = useTeamOptions();
  // Rascunho enquanto não dá para salvar (escolheu "Equipe" e falta o barco) ou enquanto salva.
  const [draft, setDraft] = useState<Link | null>(null);
  const [picker, setPicker] = useState(false);
  const link = draft ?? linkOf(profile);
  const team = teams?.find(t => t.id === link.team_id) ?? null;

  async function save(next: Link) {
    // Membro só de equipe desta edição: trocar para "membro" com equipe antiga pede outra escolha.
    const chosen = teams?.find(t => t.id === next.team_id);
    if (next.affiliation === 'team' && next.team_status === 'member' && chosen && !chosen.active) next = { ...next, team_id: null };
    setDraft(next);
    if (next.affiliation === 'team' && !next.team_id) return;
    const { error } = await supabase.rpc('update_affiliation', {
      p_affiliation: next.affiliation!, p_team_id: next.affiliation === 'team' ? next.team_id : null, p_team_status: next.affiliation === 'team' ? next.team_status : null,
    });
    if (error) notify(errorMessage(error)); else forgetAffiliations();
    await onChanged();
    setDraft(null);
  }

  return <section className="settings-group" aria-labelledby="settings-link">
    <h2 id="settings-link" className="settings-label">Vínculo com o DSB</h2>
    <div className="settings-card">
      <div className="settings-row">
        <h3 className="settings-row-title" id="settings-link-question">Como você participa?</h3>
        <div className="choice-grid" role="radiogroup" aria-labelledby="settings-link-question">
          {AFFILIATIONS.map(option => {
            const on = link.affiliation === option.id;
            return <button key={option.id} role="radio" aria-checked={on} className="choice-card"
              onClick={() => { if (!on) void save({ ...link, affiliation: option.id }); }}>
              <span className="choice-icon"><option.icon size={18} /></span>
              <span className="choice-text"><strong>{option.title}</strong><small>{option.text}</small></span>
              <span className="choice-check" aria-hidden>{on && <Check size={14} />}</span>
            </button>;
          })}
        </div>
      </div>

      {link.affiliation === 'team' && <>
        {/* Campo no formato de select: o barco escolhido com logo, ou o convite para escolher. */}
        <div className="settings-row settings-split">
          <div><h3 id="settings-team">Equipe</h3><p>{!team ? 'Escolha para salvar o vínculo.' : team.active ? 'Equipe desta edição.' : 'Equipe de edição anterior.'}</p></div>
          <button className={`select-field ${team ? '' : 'empty'}`} onClick={() => setPicker(true)} aria-haspopup="dialog" aria-labelledby="settings-team settings-team-value">
            {team && <TeamBadge team={team} small />}
            <span id="settings-team-value">{team ? team.name : 'Escolher equipe'}</span>
            <ChevronsUpDown size={16} />
          </button>
        </div>
        <div className="settings-row settings-split">
          <div><h3>Situação</h3><p>Você está no time agora ou já passou por ele?</p></div>
          <div className="segmented" role="radiogroup" aria-label="Situação na equipe">
            {(['member', 'alumni'] as const).map(id => <button key={id} role="radio" aria-checked={link.team_status === id}
              onClick={() => { if (link.team_status !== id) void save({ ...link, team_status: id }); }}>{id === 'member' ? 'Membro' : 'Ex-membro'}</button>)}
          </div>
        </div>
      </>}
    </div>
    <TeamPicker open={picker} teams={teams} alumni={link.team_status === 'alumni'} selected={link.team_id}
      onClose={() => setPicker(false)} onPick={id => { setPicker(false); void save({ ...link, affiliation: 'team', team_id: id }); }} />
  </section>;
}

function TeamPicker({ open, teams, alumni, selected, onClose, onPick }: {
  open: boolean; teams: TeamOption[] | null; alumni: boolean; selected: string | null; onClose: () => void; onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const match = (t: TeamOption) => normalize(t.name).includes(normalize(query.trim()));
  const current = (teams ?? []).filter(t => t.active && match(t));
  const past = alumni ? (teams ?? []).filter(t => !t.active && match(t)) : [];
  const row = (t: TeamOption) => <li key={t.id}>
    <button className="team-option" role="radio" aria-checked={t.id === selected} onClick={() => onPick(t.id)}>
      <TeamBadge team={t} small /><span>{t.name}</span>{t.id === selected && <Check size={18} />}
    </button>
  </li>;
  return <Sheet open={open} onClose={() => { setQuery(''); onClose(); }} title="Escolha sua equipe" subtitle={alumni ? 'Equipes desta e de edições anteriores' : 'Equipes desta edição'}>
    <label className="team-search">
      <Search size={16} />
      <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar equipe" aria-label="Buscar equipe" />
    </label>
    {!teams ? <p className="panel-note">Carregando equipes…</p> : <div role="radiogroup" aria-label="Equipes">
      {current.length > 0 && <>{alumni && <p className="team-group">Nesta edição</p>}<ul className="team-options">{current.map(row)}</ul></>}
      {past.length > 0 && <><p className="team-group">Edições anteriores</p><ul className="team-options">{past.map(row)}</ul></>}
      {!current.length && !past.length && <p className="panel-note">Nenhuma equipe com esse nome.</p>}
    </div>}
  </Sheet>;
}

function NotificationSettings({ userId }: { userId: string }) {
  const { notify } = useApp();
  const [prefs, setPrefs] = usePrefs(userId);
  // No HTML estático é sempre web; no app nativo corrige após hidratar.
  const native = useSyncExternalStore(noopSubscribe, () => Capacitor.isNativePlatform(), () => false);

  async function change(next: Partial<Prefs>) {
    if (!prefs) return;
    const updated = { ...prefs, ...next };
    setPrefs(updated);
    const { error } = await supabase.rpc('update_notification_prefs', { p_chat: updated.chat, p_fantasy: updated.fantasy, p_announcements: updated.announcements });
    if (error) { setPrefs(prefs); notify(errorMessage(error)); }
  }

  const chat = CHAT_FILTERS.find(f => f.id === (prefs?.chat ?? DEFAULT_PREFS.chat))!;
  return <section className="settings-group" aria-labelledby="settings-notifications" aria-busy={!prefs}>
    <h2 id="settings-notifications" className="settings-label">Notificações</h2>
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-split">
          <div><h3 id="settings-chat">Chat</h3></div>
          <div className="segmented" role="radiogroup" aria-labelledby="settings-chat">
            {CHAT_FILTERS.map(f => <button key={f.id} role="radio" aria-checked={chat.id === f.id} disabled={!prefs}
              onClick={() => { if (chat.id !== f.id) void change({ chat: f.id }); }}>{f.label}</button>)}
          </div>
        </div>
        <p className="settings-row-text" aria-live="polite">{chat.text}</p>
      </div>
      <Toggle title="Fantasy" text="Lembrete 1 hora antes de cada prova para ajustar sua escalação." checked={prefs?.fantasy ?? true} disabled={!prefs} onChange={fantasy => void change({ fantasy })} />
      <Toggle title="Anúncios gerais" text="Largadas das provas e recados da organização." checked={prefs?.announcements ?? true} disabled={!prefs} onChange={announcements => void change({ announcements })} />
    </div>
    <p className="settings-hint">{native
      ? 'Vale para todos os seus aparelhos. Se nada chegar, confira se as notificações do DSB estão liberadas no celular.'
      : 'As notificações chegam pelo app do DSB no celular. O que você escolher aqui vale para todos os seus aparelhos.'}</p>
  </section>;
}

function Toggle({ title, text, checked, disabled, onChange }: { title: string; text: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-row settings-split toggle-row">
    <div><h3>{title}</h3><p>{text}</p></div>
    <button type="button" role="switch" className="toggle" aria-checked={checked} aria-label={title} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
  </label>;
}
