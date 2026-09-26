import type { CapacitorConfig } from '@capacitor/cli';

// O app das lojas carrega o site publicado, então atualizações entram na hora,
// sem passar por revisão. Para trocar de domínio, mude só esta constante
// (e refaça o build do app, porque o endereço vai dentro do instalador).
const site = process.env.APP_SITE_URL ?? 'https://dsb.app.br';

const config: CapacitorConfig = {
  appId: 'br.com.desafiosolar.app',
  appName: 'DSB',
  webDir: 'out',
  backgroundColor: '#422378',
  server: {
    url: site,
    cleartext: false,
    // Navegação permitida dentro do app; o resto abre no navegador do sistema.
    allowNavigation: [new URL(site).hostname, 'ztzmvdmggxyokfbakajq.supabase.co'],
    errorPath: '/offline.html',
  },
  ios: { contentInset: 'never' },
  plugins: {
    SplashScreen: {
      // O app carrega um site: sem segurar, a abertura apaga antes de haver o que mostrar
      // e sobra um retângulo da cor de fundo. Quem esconde é hideSplash(), já com interface.
      launchAutoHide: false,
      // Rede ruim não pode deixar ninguém preso na tela de abertura.
      launchShowDuration: 5000,
      backgroundColor: '#422378',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
  },
};
export default config;
