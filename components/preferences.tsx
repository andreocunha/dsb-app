'use client';
import { useState } from 'react';
import { Check, LogIn, LogOut, Moon, Sun, Trash2 } from 'lucide-react';
import { useApp } from './app-shell';
import { useAuth } from './auth';
import { Sheet } from './ui';
import { supabase, errorMessage } from '@/lib/supabase';

export function Preferences() {
  const { theme, setTheme, notify } = useApp();
  const { userId, profile, requireLogin, signOut, reloadProfile } = useAuth();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const name = (draft ?? profile?.name ?? '').trim();
    if (!name) return;
    const { error } = await supabase.rpc('update_profile', { p_name: name });
    if (error) { notify(errorMessage(error)); return; }
    await reloadProfile();
    setDraft(null);
    notify('Seu nome foi atualizado.');
  }

  async function deleteAccount() {
    setBusy(true);
    // Remove os arquivos enviados no chat antes de apagar a conta.
    const folders = await supabase.storage.from('chat').list(userId!, { limit: 1000 });
    for (const folder of folders.data ?? []) {
      const files = await supabase.storage.from('chat').list(`${userId}/${folder.name}`);
      const paths = (files.data ?? []).map(f => `${userId}/${folder.name}/${f.name}`);
      if (paths.length) await supabase.storage.from('chat').remove(paths);
    }
    const { error } = await supabase.rpc('delete_account');
    setBusy(false);
    if (error) { notify(errorMessage(error)); return; }
    setConfirmDelete(false);
    await signOut();
    notify('Sua conta e seus dados foram excluídos.');
  }

  return <div className="page settings">
    <div className="page-heading"><div><h1>Configurações</h1></div></div>
    <section className="card">
      <h2>Sua conta</h2>
      {userId ? <>
        <form className="name-field" onSubmit={e => void saveName(e)}>
          <label htmlFor="display-name">Nome no chat e no ranking</label>
          <div><input id="display-name" required maxLength={40} value={draft ?? profile?.name ?? ''} onChange={e => setDraft(e.target.value)} /><button className="button primary" type="submit"><Check size={16} /> Salvar</button></div>
        </form>
        <div className="account-actions">
          <button className="button" onClick={() => void signOut()}><LogOut size={16} /> Sair</button>
          <button className="button danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Excluir conta</button>
        </div>
      </> : <div className="account-actions">
        <p className="muted">Você está navegando sem conta. Entre para usar o chat e o fantasy.</p>
        <button className="button primary" onClick={() => requireLogin()}><LogIn size={16} /> Entrar</button>
      </div>}
    </section>
    <section className="card">
      <h2>Aparência</h2>
      <div className="theme-options">
        {[{ id: 'light', title: 'Tema claro', icon: Sun }, { id: 'dark', title: 'Tema escuro', icon: Moon }].map(option => <button key={option.id} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}><option.icon size={18} />{option.title}{theme === option.id && <Check size={16} />}</button>)}
      </div>
    </section>
    <p className="footnote legal-link">Ao usar o chat e o fantasy você concorda com a nossa <a className="text-link" href="/privacidade/">política de privacidade</a>.</p>
    <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir sua conta?">
      <div className="prose">
        <p>Isso apaga seu perfil, suas mensagens, arquivos enviados, reações e escalações do fantasy. <strong>Não dá para desfazer.</strong></p>
        <div className="account-actions">
          <button className="button" onClick={() => setConfirmDelete(false)}>Cancelar</button>
          <button className="button danger-solid" disabled={busy} onClick={() => void deleteAccount()}><Trash2 size={16} /> {busy ? 'Excluindo…' : 'Excluir definitivamente'}</button>
        </div>
      </div>
    </Sheet>
  </div>;
}
