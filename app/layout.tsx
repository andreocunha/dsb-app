import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import "./minimal.css";
export const metadata: Metadata = {
  title: { default: "DSB • Desafio Solar Brasil", template: "%s • DSB" },
  description: "A energia do sol. A emoção da competição. Acompanhe o Desafio Solar Brasil, encontre a comunidade e monte seu fantasy.",
  applicationName: "DSB", appleWebApp: { capable: true, statusBarStyle: "default", title: "DSB" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#422c70" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}><body><AppShell>{children}</AppShell></body></html>;
}
