'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { House, MessageCircle, Trophy, Menu, ChevronRight, Settings, Sun, Moon, LogOut, Download, Check, X, WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Brand, Sheet } from './ui';
import { useLocalState } from '@/lib/local-state';
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const AppContext = createContext<{ theme: string; setTheme: (theme: string) => void; notify: (message: string) => void }>({ theme: 'light', setTheme: () => {}, notify: () => {} });
export const useApp = () => useContext(AppContext);
const navigation = [{ href: '/', label: 'Home', icon: House }, { href: '/comunidade/', label: 'Chat', icon: MessageCircle }, { href: '/fantasy/', label: 'Fantasy', icon: Trophy }];

function ThemeSwitch({ theme, setTheme }: { theme: string; setTheme: (theme: string) => void }) {
  return <div className="theme-switch">
    <button aria-label="Tema claro" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={16} /></button>
    <button aria-label="Tema escuro" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={16} /></button>
  </div>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useLocalState('dsb-theme', 'light');
  const [menu, setMenu] = useState(false);
  const [installInfo, setInstallInfo] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [toast, setToast] = useState('');
  const [offline, setOffline] = useState(false);
  const [guest, setGuest] = useLocalState('dsb-guest', false);
  const [name] = useLocalState('dsb-name', 'Torcedor Solar');
  const active = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href.slice(0, -1));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const updateOnline = () => setOffline(!navigator.onLine);
    const beforeInstall = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent); };
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline); window.addEventListener('beforeinstallprompt', beforeInstall);
    updateOnline();
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Não foi possível preparar o modo offline:', error));
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); window.removeEventListener('beforeinstallprompt', beforeInstall); };
  }, []);
  async function install() {
    if (installEvent) { await installEvent.prompt(); const choice = await installEvent.userChoice; if (choice.outcome === 'accepted') setToast('DSB adicionado ao seu dispositivo!'); setInstallEvent(null); }
    else setInstallInfo(true);
  }
  function toggleGuest() {
    setGuest(!guest); setMenu(false);
    setToast(guest ? 'Você voltou ao perfil de demonstração.' : 'Você saiu do perfil demo e está navegando como visitante.');
  }
  const displayName = guest ? 'Visitante' : name;
  const settingsActive = pathname.startsWith('/configuracoes');

  return <AppContext.Provider value={{ theme, setTheme, notify: setToast }}>
    <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
    <aside className="sidebar">
      <Link href="/" aria-label="Solar Brasil — início"><Brand /></Link>
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navigation.map(item => (
          <Link key={item.href} href={item.href} className={active(item.href) ? 'active' : ''} aria-current={active(item.href) ? 'page' : undefined}>
            <item.icon size={19} /><span>{item.label}</span>
          </Link>
        ))}
        <Link href="/configuracoes/" className={settingsActive ? 'active' : ''} aria-current={settingsActive ? 'page' : undefined}><Settings size={19} /><span>Configurações</span></Link>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-row"><span>Aparência</span><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
        <button className="sidebar-row" onClick={() => void install()}><span>Instalar aplicativo</span><Download size={16} /></button>
        <div className="sidebar-profile">
          <span className="avatar"><Sun size={16} /></span>
          <div><strong>{displayName}</strong><small>{guest ? 'Navegando sem perfil' : 'Perfil de demonstração'}</small></div>
          <button className="icon-button" onClick={toggleGuest} aria-label={guest ? 'Usar perfil de demonstração' : 'Sair do perfil demo'}><LogOut size={16} /></button>
        </div>
      </div>
    </aside>
    <main id="main-content" className="main">
      {offline && <div className="offline-banner"><WifiOff size={15} /> Você está offline. Mapa e live precisam de conexão.</div>}
      {children}
    </main>
    <nav className="mobile-nav" aria-label="Navegação mobile">
      {navigation.map(item => (
        <Link key={item.href} href={item.href} className={active(item.href) && !menu ? 'active' : ''} aria-current={active(item.href) ? 'page' : undefined}>
          <item.icon size={22} /><span>{item.label}</span>
        </Link>
      ))}
      <button className={menu || settingsActive ? 'active' : ''} onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={22} /><span>Menu</span></button>
    </nav>
    <Sheet open={menu} onClose={() => setMenu(false)} title="Seu espaço">
      <div className="menu-profile"><span className="avatar large"><Sun size={22} /></span><div><h3>{displayName}</h3><p>{guest ? 'Navegando sem perfil' : 'Perfil de demonstração'}</p></div></div>
      <Link href="/configuracoes/" className="sheet-row" onClick={() => setMenu(false)}><Settings size={20} /><span>Configurações</span><ChevronRight size={18} /></Link>
      <div className="sheet-row"><Sun size={20} /><span>Aparência</span><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
      <button className="sheet-row" onClick={() => { setMenu(false); void install(); }}><Download size={20} /><span>Instalar aplicativo</span><ChevronRight size={18} /></button>
      <button className="sheet-row danger" onClick={toggleGuest}><LogOut size={20} /><span>{guest ? 'Usar perfil de demonstração' : 'Sair do perfil demo'}</span></button>
      <p className="footnote">DSB · Versão 0.1.0 · Dados demonstrativos, sem login.</p>
    </Sheet>
    <Sheet open={installInfo} onClose={() => setInstallInfo(false)} title="Leve o DSB com você">
      <div className="prose">
        <p>No iPhone, abra no Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
        <p>No Android ou desktop, abra o menu do navegador e procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</p>
        <p className="footnote">Se a opção não aparecer, o app pode já estar instalado ou o navegador não oferecer instalação. A instalação fica disponível na versão de produção com HTTPS.</p>
      </div>
    </Sheet>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16} /></button></div>}
  </AppContext.Provider>;
}
