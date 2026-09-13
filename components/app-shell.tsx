'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { House, MessageCircle, Trophy, Menu, ArrowUpRight, Settings, Sun, Moon, LogOut, Download, Check, X, WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Brand, Sheet } from './ui';
import { useLocalState } from '@/lib/local-state';
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const AppContext = createContext<{ theme: string; setTheme: (theme: string) => void; notify: (message: string) => void }>({ theme: 'light', setTheme: () => {}, notify: () => {} });
export const useApp = () => useContext(AppContext);
const navigation = [{ href: '/', label: 'Home', mobile: 'Home', icon: House }, { href: '/comunidade/', label: 'Chat', mobile: 'Chat', icon: MessageCircle }, { href: '/fantasy/', label: 'Fantasy', mobile: 'Fantasy', icon: Trophy }];
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
  return <AppContext.Provider value={{ theme, setTheme, notify: setToast }}>
    <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
    <div className="minimal-shell">
      <header className="app-header">
        <Link href="/" aria-label="Solar Brasil — início"><Brand /></Link>
        <nav className="desktop-nav" aria-label="Navegação principal">
          {navigation.map(item => (
            <Link key={item.href} href={item.href} className={active(item.href) ? 'active' : ''} aria-current={active(item.href) ? 'page' : undefined}>
              <item.icon size={20} /><span>{item.label}</span>
            </Link>
          ))}
          <button className={menu || pathname.startsWith('/configuracoes') ? 'active' : ''} onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={20} /><span>Menu</span></button>
        </nav>
      </header>
      {offline && <div className="offline-banner"><WifiOff size={15} /> Você está offline. Mapa e live precisam de conexão.</div>}
      <main id="main-content" className="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Navegação mobile">
        {navigation.map(item => (
          <Link key={item.href} href={item.href} className={active(item.href) && !menu ? 'active' : ''} aria-current={active(item.href) ? 'page' : undefined}>
            <item.icon size={25} /><span>{item.mobile}</span>
          </Link>
        ))}
        <button className={menu || pathname.startsWith('/configuracoes') ? 'active' : ''} onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={25} /><span>Menu</span></button>
      </nav>
    </div>
    <Sheet open={menu} onClose={() => setMenu(false)} title="Seu espaço"><div className="menu-profile"><span className="profile-avatar large"><Sun size={26} /></span><div><h3>{guest ? 'Visitante' : name}</h3><p>{guest ? 'Visitante' : 'Perfil de demonstração'}</p></div><span className="tag">Demo</span></div><Link href="/configuracoes/" className="sheet-row" onClick={() => setMenu(false)}><Settings size={21} /><span>Configurações</span><ArrowUpRight size={18} /></Link><div className="sheet-row"><Sun size={21} /><span>Aparência</span><div className="theme-switch"><button aria-label="Tema claro" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Sun size={17} /></button><button aria-label="Tema escuro" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Moon size={17} /></button></div></div><button className="sheet-row" onClick={() => { setMenu(false); void install(); }}><Download size={21} /><span>Instalar aplicativo</span><ArrowUpRight size={18} /></button><button className="sheet-row logout" onClick={() => { setGuest(!guest); setMenu(false); setToast(guest ? 'Você voltou ao perfil de demonstração.' : 'Você saiu do perfil demo e está navegando como visitante.'); }}><LogOut size={21} /><span>{guest ? 'Usar perfil de demonstração' : 'Sair do perfil demo'}</span></button><p className="sheet-footnote">DSB · Versão 0.1.0<br />Dados demonstrativos · Sem login.</p></Sheet>
    <Sheet open={installInfo} onClose={() => setInstallInfo(false)} title="Leve o DSB com você"><div className="install-info"><span className="soft-icon gold"><Download size={28} /></span><h3>Sua torcida, a um toque de distância.</h3><p>No iPhone, abra no Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p><p>No Android ou desktop, abra o menu do navegador e procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</p><p className="muted">Se a opção não aparecer, o app pode já estar instalado ou o navegador não oferecer instalação. A instalação fica disponível na versão de produção com HTTPS.</p></div></Sheet>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16} /></button></div>}
  </AppContext.Provider>;
}
