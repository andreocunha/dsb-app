'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { House, MessageCircle, Trophy, Menu, ChevronRight, Settings, ShieldCheck, Sun, Moon, LogIn, LogOut, Download, Check, X, WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Avatar, Brand, Sheet } from './ui';
import { useAuth } from './auth';
import { useLocalState } from '@/lib/local-state';
import { supabase } from '@/lib/supabase';
import { registerPush } from '@/lib/push';
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type AppValue = { theme: string; setTheme: (theme: string) => void; notify: (message: string) => void };
const AppContext = createContext<AppValue>({ theme: 'light', setTheme: () => {}, notify: () => {} });
export const useApp = () => useContext(AppContext);
// Contexto separado: só quem mostra o contador re-renderiza quando alguém entra ou sai.
const OnlineContext = createContext(0);
export const useOnline = () => useContext(OnlineContext);
const navigation = [{ href: '/', label: 'Home', icon: House }, { href: '/comunidade/', label: 'Chat', icon: MessageCircle }, { href: '/fantasy/', label: 'Fantasy', icon: Trophy }];

function ThemeSwitch({ theme, setTheme }: { theme: string; setTheme: (theme: string) => void }) {
  return <div className="theme-switch">
    <button aria-label="Tema claro" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={16} /></button>
    <button aria-label="Tema escuro" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={16} /></button>
  </div>;
}

const noopSubscribe = () => () => {};

// Mensagens não lidas: o último id lido fica no aparelho e o total aparece no menu.
const READ_KEY = 'dsb-chat-read';
const lastRead = () => { try { return Number(localStorage.getItem(READ_KEY)) || 0; } catch { return 0; } };
type UnreadValue = { unread: number; markRead: (lastId: number) => void };
const UnreadContext = createContext<UnreadValue>({ unread: 0, markRead: () => {} });
export const useChatUnread = () => useContext(UnreadContext);

function useUnread(userId: string | null) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    void supabase.rpc('unread_count', { p_after: lastRead() }).then(({ data }) => { if (alive) setUnread(data ?? 0); });
    const channel = supabase.channel('chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        if (row.user_id !== userId && row.id > lastRead()) setUnread(count => count + 1);
      })
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [userId]);
  const markRead = useCallback((lastId: number) => {
    if (lastId <= lastRead()) return;
    try { localStorage.setItem(READ_KEY, String(lastId)); } catch { /* sem localStorage: só nesta sessão */ }
    setUnread(0);
  }, []);
  return { unread, markRead };
}

/** Quantas pessoas estão com o app aberto agora (Realtime Presence, sem login). */
function useOnlineCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const channel = supabase.channel('online', { config: { presence: { key: crypto.randomUUID() } } });
    channel
      .on('presence', { event: 'sync' }, () => setCount(Object.keys(channel.presenceState()).length))
      .subscribe(status => { if (status === 'SUBSCRIBED') void channel.track({}); });
    return () => { void supabase.removeChannel(channel); };
  }, []);
  return count;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { userId, profile, requireLogin, signOut } = useAuth();
  const [theme, setTheme] = useLocalState('dsb-theme', 'light');
  const [menu, setMenu] = useState(false);
  const [installInfo, setInstallInfo] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [toast, setToast] = useState('');
  const [offline, setOffline] = useState(false);
  const online = useOnlineCount();
  const { unread, markRead } = useUnread(userId);
  // No HTML estático é sempre web; no app nativo corrige após hidratar.
  const native = useSyncExternalStore(noopSubscribe, () => Capacitor.isNativePlatform(), () => false);
  const active = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href.slice(0, -1));
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4200); return () => clearTimeout(id); }, [toast]);
  // Registra de novo ao entrar/sair, para associar o aparelho à conta.
  useEffect(() => { void registerPush(setToast); }, [userId]);
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
  async function logout() {
    setMenu(false);
    await signOut();
    setToast('Você saiu da sua conta.');
  }
  const settingsActive = pathname.startsWith('/configuracoes');

  return <AppContext.Provider value={{ theme, setTheme, notify: setToast }}><OnlineContext.Provider value={online}><UnreadContext.Provider value={{ unread, markRead }}>
    <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
    <aside className="sidebar">
      <Link href="/" aria-label="Solar Brasil — início"><Brand /></Link>
      <nav className="sidebar-nav" aria-label="Navegação principal">
        {navigation.map(item => (
          <Link key={item.href} href={item.href} className={active(item.href) ? 'active' : ''} aria-current={active(item.href) ? 'page' : undefined}>
            <item.icon size={19} /><span>{item.label}</span>
            {item.href === '/comunidade/' && unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        ))}
        <Link href="/configuracoes/" className={settingsActive ? 'active' : ''} aria-current={settingsActive ? 'page' : undefined}><Settings size={19} /><span>Configurações</span></Link>
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-row"><span>Aparência</span><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
        {!native && <button className="sidebar-row" onClick={() => void install()}><span>Instalar aplicativo</span><Download size={16} /></button>}
        {userId ? <div className="sidebar-profile">
          <Avatar id={userId} name={profile?.name ?? ''} url={profile?.avatar_url} />
          <div><strong>{profile?.name ?? '…'}</strong><small>Conectado</small></div>
          <button className="icon-button" onClick={() => void logout()} aria-label="Sair da conta"><LogOut size={16} /></button>
        </div> : <button className="button primary sidebar-login" onClick={() => requireLogin()}><LogIn size={16} /> Entrar</button>}
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
          {item.href === '/comunidade/' && unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </Link>
      ))}
      <button className={menu || settingsActive ? 'active' : ''} onClick={() => setMenu(true)} aria-haspopup="dialog"><Menu size={22} /><span>Menu</span></button>
    </nav>
    <Sheet open={menu} onClose={() => setMenu(false)} title="Seu espaço">
      {userId
        ? <div className="menu-profile"><Avatar id={userId} name={profile?.name ?? ''} url={profile?.avatar_url} /><div><h3>{profile?.name ?? '…'}</h3><p>Conectado</p></div></div>
        : <button className="menu-profile" onClick={() => { setMenu(false); requireLogin(); }}><span className="avatar"><LogIn size={16} /></span><div><h3>Entrar</h3><p>Para usar o chat e o fantasy</p></div></button>}
      <Link href="/configuracoes/" className="sheet-row" onClick={() => setMenu(false)}><Settings size={20} /><span>Configurações</span><ChevronRight size={18} /></Link>
      <div className="sheet-row"><Sun size={20} /><span>Aparência</span><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
      {!native && <button className="sheet-row" onClick={() => { setMenu(false); void install(); }}><Download size={20} /><span>Instalar aplicativo</span><ChevronRight size={18} /></button>}
      {userId && <button className="sheet-row danger" onClick={() => void logout()}><LogOut size={20} /><span>Sair da conta</span></button>}
      <Link href="/privacidade/" className="sheet-row" onClick={() => setMenu(false)}><ShieldCheck size={20} /><span>Privacidade</span><ChevronRight size={18} /></Link>
      <p className="footnote">DSB · Desafio Solar Brasil · Versão 0.1.0</p>
    </Sheet>
    <Sheet open={installInfo} onClose={() => setInstallInfo(false)} title="Leve o DSB com você">
      <div className="prose">
        <p>No iPhone, abra no Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
        <p>No Android ou desktop, abra o menu do navegador e procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</p>
        <p className="footnote">Se a opção não aparecer, o app pode já estar instalado ou o navegador não oferecer instalação.</p>
      </div>
    </Sheet>
    {toast && <div className="toast" role="status"><Check size={18} /><span>{toast}</span><button aria-label="Dispensar aviso" onClick={() => setToast('')}><X size={16} /></button></div>}
  </UnreadContext.Provider></OnlineContext.Provider></AppContext.Provider>;
}
