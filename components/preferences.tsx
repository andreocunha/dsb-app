'use client';
import { useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { useApp } from './app-shell';
import { useLocalState } from '@/lib/local-state';
export function Preferences() {
  const { theme, setTheme, notify } = useApp();
  const [name, setName] = useLocalState('dsb-name', 'Torcedor Solar');
  const [raceAlerts, setRaceAlerts] = useLocalState('dsb-race-alerts', true);
  const [communityAlerts, setCommunityAlerts] = useLocalState('dsb-community-alerts', false);
  const [draft, setDraft] = useState<string | null>(null);
  const toggles = [
    { title: 'Novidades das provas', description: 'Largadas, resultados e momentos importantes.', value: raceAlerts, set: setRaceAlerts },
    { title: 'Atividade da comunidade', description: 'Fique por dentro das conversas da torcida.', value: communityAlerts, set: setCommunityAlerts },
  ];
  return <div className="page settings">
    <div className="page-heading"><div><h1>Configurações</h1><p>Tudo fica salvo neste dispositivo. Nenhuma conta é necessária.</p></div></div>
    <section className="card">
      <h2>Seu perfil</h2>
      <form className="name-field" onSubmit={e => { e.preventDefault(); const value = (draft ?? name).trim(); if (!value) return; setName(value); setDraft(null); notify('Seu nome foi atualizado.'); }}>
        <label htmlFor="display-name">Nome de exibição</label>
        <div><input id="display-name" required maxLength={40} value={draft ?? name} onChange={e => setDraft(e.target.value)} /><button className="button primary" type="submit"><Check size={16} /> Salvar</button></div>
      </form>
    </section>
    <section className="card">
      <h2>Aparência</h2>
      <div className="theme-options">
        {[{ id: 'light', title: 'Tema claro', icon: Sun }, { id: 'dark', title: 'Tema escuro', icon: Moon }].map(option => <button key={option.id} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}><option.icon size={18} />{option.title}{theme === option.id && <Check size={16} />}</button>)}
      </div>
    </section>
    <section className="card">
      <h2>Notificações</h2>
      {toggles.map(item => <div className="preference-row" key={item.title}>
        <div><h3>{item.title}</h3><p>{item.description}</p></div>
        <button className="toggle" role="switch" aria-checked={item.value} aria-label={item.title} onClick={() => item.set(!item.value)}><span /></button>
      </div>)}
      <p className="footnote">Nesta demonstração, nenhum alerta push é enviado.</p>
    </section>
  </div>;
}
