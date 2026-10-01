'use client';
import { usePathname } from 'next/navigation';
import { AppShell } from './app-shell';
import { AuthProvider } from './auth';

// Páginas públicas que ficam fora do app: sem menu, sem botão "Entrar" e sem a janela de login.
// A /sobre é a página inicial da tela de consentimento do Google, e o verificador da marca
// recusa uma página inicial que tenha login ("Sua página inicial está protegida por uma página de login").
const BARE = ['/sobre'];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE.some(path => pathname.startsWith(path))) return <main id="main-content" className="site-page">{children}</main>;
  return <AuthProvider><AppShell>{children}</AppShell></AuthProvider>;
}
