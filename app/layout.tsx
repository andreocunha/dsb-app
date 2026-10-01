import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SiteChrome } from "@/components/site-chrome";
import "./globals.css";
import "./chat.css";
export const metadata: Metadata = {
  title: { default: "DSB • Desafio Solar Brasil", template: "%s • DSB" },
  description: "A energia do sol. A emoção da competição. Acompanhe o Desafio Solar Brasil, encontre a comunidade e monte seu fantasy.",
  applicationName: "DSB", appleWebApp: { capable: true, statusBarStyle: "default", title: "DSB" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  // Posse de dsb.app.br no Search Console, exigida para mostrar a marca no login com Google.
  verification: { google: "W47X3qr-mr9EjeU-pE0M70iO6wIbampySybbudUQqP8" },
};
// A barra do navegador acompanha o tema, com as mesmas cores de --surface em theme.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#211b2a" },
  ],
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}><body><SiteChrome>{children}</SiteChrome></body></html>;
}
