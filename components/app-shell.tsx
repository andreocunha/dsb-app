'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { House, MessageCircle, Trophy, Menu, ArrowUpRight, Bell, ChevronDown, Settings, Sun, Moon, LogOut, Compass, Download, Check, X, WifiOff, Waves } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Brand, Sheet } from './ui';
import { useLocalState } from '@/lib/local-state';
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const AppContext = createContext<{ theme: string; setTheme: (theme: string) => void; notify: (message: string) => void }>({ theme: 'light', setTheme: () => {}, notify: () => {} });
export const useApp = () => useContext(AppContext);
const navigation = [{ href: '/', label: 'Visão geral', mobile: 'Início', icon: House }, { href: '/comunidade/', label: 'Comunidade', mobile: 'Chat', icon: MessageCircle }, { href: '/fantasy/', label: 'Fantasy', mobile: 'Fantasy', icon: Trophy }];
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useLocalState('dsb-theme', 'light');
  const [menu, setMenu] = useState(false);
  const [notifications, setNotifications] = useState(false);
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
  return <AppContext.Provider value={{ theme, setTheme, notify: setToast }}><a href="#main-content" className="skip-link">Pular para o conteúdo</a><div className="app-shell">
    <aside className="sidebar"><Link href="/" aria-label="DSB início"><Brand /></Link><div className="edition-label">A ENERGIA QUE NOS MOVE</div><div className="nav-label">ACOMPANHE O DESAFIO</div><nav aria-label="Navegação principal">{navigation.map(item => <Link key={item.href} aria-current={active(item.href) ? 'page' : undefined} className={`nav-item ${active(item.href) ? 'active' : ''}`} href={item.href}><item.icon size={20} /><span>{item.label}</span>{item.label === 'Comunidade' && <span className="nav-count">5</span>}{active(item.href) && <span className="nav-active-dot" />}</Link>)}<button className={`nav-item ${menu ? 'active' : ''}`} onClick={() => setMenu(true)}><Menu size={20} /><span>Menu</span></button></nav>
    <div className="sidebar-bottom"><div className="solar-note"><span className="solar-note-icon"><Sun size={24} /></span><h3>Movidos pelo sol.<br />Conectados pelo futuro.</h3><p>Inovação, sustentabilidade<br />e muita água pela frente.</p><Waves className="solar-note-waves" size={150} strokeWidth={.5} /></div><button className="install-link" onClick={install}><Download size={17} /> Instalar aplicativo <ArrowUpRight size={15} /></button><div className="sidebar-footer"><span>DSB © 2026</span><Sun size={13} /></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="desktop-breadcrumb">Desafio Solar Brasil <span>/</span><strong>{navigation.find(item => active(item.href))?.label ?? 'Configurações'}</strong></div><Link href="/" className="mobile-brand" aria-label="DSB início"><Brand compact /></Link><div className="topbar-actions"><span className="edition-pill"><span /> Edição 2026</span><button className="icon-button notification-button" aria-label="Notificações" onClick={() => setNotifications(true)}><Bell size={20} /><i /></button><span className="header-divider" /><button className="profile-button" onClick={() => setMenu(true)} aria-label="Abrir menu do perfil"><span className="profile-avatar">{guest ? 'V' : name.slice(0, 1).toUpperCase()}<Sun size={13} /></span><ChevronDown size={15} /></button></div></header>
    {offline && <div className="offline-banner"><WifiOff size={15} /> Você está offline. Continue explorando os dados salvos.</div>}<main id="main-content" className="main-content">{children}</main><footer className="main-footer"><span>Um desafio. Muitas equipes. A mesma energia.</span><span><span className="tiny-dot" /> Ambiente demonstrativo</span></footer></div>
    <nav className="mobile-nav" aria-label="Navegação mobile">{navigation.map(item => <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className={active(item.href) ? 'active' : ''}><item.icon size={22} /><span>{item.mobile}</span></Link>)}<button className={menu ? 'active' : ''} onClick={() => setMenu(true)}><Menu size={22} /><span>Menu</span></button></nav>
    </div>
    <Sheet open={menu} onClose={() => setMenu(false)} title="Seu espaço"><div className="menu-profile"><span className="profile-avatar large"><Sun size={26} /></span><div><h3>{guest ? 'Visitante' : name}</h3><p>{guest ? 'Explorando o Desafio Solar Brasil' : 'Fazendo parte dessa energia ☀️'}</p></div><span className="tag">Demo</span></div><Link href="/configuracoes/" className="sheet-row" onClick={() => setMenu(false)}><Settings size={21} /><span>Configurações<small>Deixe o DSB do seu jeito</small></span><ArrowUpRight size={18} /></Link><div className="sheet-row"><Sun size={21} /><span>Aparência<small>Escolha seu tema favorito</small></span><div className="theme-switch"><button aria-label="Tema claro" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Sun size={17} /></button><button aria-label="Tema escuro" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Moon size={17} /></button></div></div><button className="sheet-row" onClick={() => { setMenu(false); void install(); }}><Download size={21} /><span>Instalar aplicativo<small>O desafio sempre com você</small></span><ArrowUpRight size={18} /></button><button className="sheet-row logout" onClick={() => { setGuest(!guest); setMenu(false); setToast(guest ? 'Você voltou ao perfil de demonstração.' : 'Você saiu do perfil demo e está navegando como visitante.'); }}><LogOut size={21} /><span>{guest ? 'Usar perfil de demonstração' : 'Sair do perfil demo'}</span></button><p className="sheet-footnote">DSB · Versão 0.1.0<br />Uma experiência de demonstração, sem login.</p></Sheet>
    <Sheet open={notifications} onClose={() => setNotifications(false)} title="Na sua energia"><div className="notification-item"><span className="soft-icon"><Compass size={22} /></span><div><h3>A próxima largada está chegando</h3><p>A prova de resistência começa às 14h. Prepare sua torcida!</p><small>Programação de demonstração</small></div></div><div className="notification-item"><span className="soft-icon gold"><Trophy size={22} /></span><div><h3>Seu palpite entra na água</h3><p>Monte sua escalação no fantasy e escolha sua equipe capitã.</p><Link href="/fantasy/" className="text-link" onClick={() => setNotifications(false)}>Montar minha equipe →</Link></div></div></Sheet>
    <Sheet open={installInfo} onClose={() => setInstallInfo(false)} title="Leve o DSB com você"><div className="install-info"><span className="soft-icon gold"><Download size={28} /></span><h3>Sua torcida, a um toque de distância.</h3><p>No iPhone, abra no Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p><p>No Android ou desktop, abra o menu do navegador e procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</p><p className="muted">Se a opção não aparecer, o app pode já estar instalado ou o navegador não oferecer instalação. A instalação fica disponível na versão de produção com HTTPS.</p></div></Sheet>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16} /></button></div>}
  </AppContext.Provider>;
}
