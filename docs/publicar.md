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

## Manutenção com prazo

- **Client secret da Apple**: expira em **22/03/2027**. Para renovar:
  `node scripts/apple-secret.mjs ~/Downloads/secrets-dsb/AuthKey_7SW5GPASD5.p8`
  e colar o conteúdo de `apple-secret.txt` em Supabase → Authentication → Providers → Apple.
  Sem o `.p8` não há como gerar: a Apple não permite baixá-lo de novo.
- Dados da conta Apple: Team ID `95TBL54DM8`, App ID `br.com.desafiosolar.app`,
  Services ID `br.com.desafiosolar.app.signin`, chave de login `7SW5GPASD5`, chave APNs `H2PW78SD6Q`.

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

Pronto: Firebase criado, `google-services.json` e `GoogleService-Info.plist` nos projetos nativos,
chave APNs enviada ao Firebase, `NEXT_PUBLIC_PUSH_ENABLED=true`, Edge Function `send-push` publicada
e agendamento no banco (`cron.job` "avisos-das-provas", a cada 5 minutos).

Falta só colocar os segredos, que são seus e não passam por aqui:

1. Supabase → Edge Functions → Secrets:
   - `FCM_SERVICE_ACCOUNT`: o JSON da conta de serviço do Firebase
     (Firebase → Configurações do projeto → Contas de serviço → Gerar nova chave privada).
   - `CRON_SECRET`: uma senha qualquer que você inventar.
2. Supabase → Integrations → Vault: criar o segredo `cron_secret` com **o mesmo valor** do `CRON_SECRET`.
   É por ele que o agendamento se identifica na função.

Para mandar um recado manual para todo mundo, chame a função com
`{"modo":"aviso","titulo":"...","texto":"..."}` e o cabeçalho `x-cron-secret`.
