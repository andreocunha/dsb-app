# Publicar nas lojas

O app das lojas **carrega o site publicado** (`server.url` no `capacitor.config.ts`).
Mudanças no site entram na hora, sem passar por revisão. Só é preciso gerar uma nova
versão do app quando mudar algo nativo: ícone, permissões, plugins ou o endereço do site.

## Rodar localmente

```bash
npm run dev            # site
npm run build          # gera out/ (usado como fallback offline no app)
npx cap sync           # leva build e configuração para ios/ e android/
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

**Android precisa de Java 21** (o Capacitor 8 não aceita o 17). Pelo terminal:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
```

## Trocar de domínio

Mude `site` no `capacitor.config.ts` (ou a variável `APP_SITE_URL`), refaça o build do app
e envie uma nova versão para as lojas. Também atualize:

- Supabase → Authentication → URL Configuration (Site URL e Redirect URLs);
- Google Cloud → Branding (página inicial e política de privacidade) e domínios autorizados;
- a política de privacidade em `app/privacidade/page.tsx`, se citar o endereço.

## O que já está pronto

- Login com Google no navegador e no app (deep link `dsbapp://login`).
- Tela de consentimento do Google publicada ("Em produção").
- Exclusão de conta dentro do app, denúncia e bloqueio no chat: o que as lojas exigem.
- Política de privacidade em `/privacidade`.
- Ícones e telas de abertura nativos gerados a partir de `assets/`.

## O que falta

### Apple
1. Registrar o App ID `br.com.desafiosolar.app` com **Sign In with Apple** e **Push Notifications**.
2. Criar um **Services ID** (ex.: `br.com.desafiosolar.app.signin`) com o domínio do site e a
   URL de retorno `https://ztzmvdmggxyokfbakajq.supabase.co/auth/v1/callback`.
3. Criar uma **chave (.p8)** para Sign In with Apple e cadastrar no Supabase
   (Authentication → Providers → Apple). A chave e o segredo são baixados e colados por você.
4. Criar uma **chave APNs (.p8)** e subir no Firebase, para as notificações no iPhone.
5. App Store Connect: criar o app, preencher ficha, privacidade e enviar para revisão.

### Google Play
1. Criar o app no Play Console com o pacote `br.com.desafiosolar.app`.
2. Ativar o Play App Signing e pegar o **SHA-1 da chave de publicação**.
3. Formulário de segurança de dados e classificação indicativa.
4. Conta pessoal nova exige **teste fechado com 12 testadores por 14 dias** antes de publicar.

### Notificações
1. Criar um projeto no Firebase (gratuito) e registrar os apps iOS e Android.
2. Colocar `google-services.json` em `android/app/` e `GoogleService-Info.plist` em `ios/App/App/`.
3. Ligar `NEXT_PUBLIC_PUSH_ENABLED=true` e criar a função que dispara os avisos das provas.
