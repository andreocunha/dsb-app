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
- Login por e-mail e senha, discreto, para as contas de revisão das lojas: Google e Apple não
  entregam credencial que um revisor possa usar, e as duas lojas exigem uma.
- Moderação do chat: `profiles.role = 'moderator'` apaga qualquer mensagem; os outros só as suas.

## Estado das lojas

Ambas receberam a versão **1.0 (build 1)** em 22/09/2026 e estão em análise.

### Apple
Tudo preenchido: ficha, privacidade do app (6 tipos de dado, todos ligados à identidade,
nenhum para rastreamento), classificação **13+** (a calculadora da Apple dava 4+, mas o chat
aberto pede o mesmo 13+ declarado no Play), preço **grátis** em todos os países, direitos de
conteúdo como "tenho os direitos necessários" (o app usa a marca do evento e mostra fotos e
vídeos enviados por usuários) e dados de acesso para o revisor.

O alvo do Xcode continua chamado `App` — renomeá-lo quebraria as referências do projeto e do
Capacitor. Quem define o nome que aparece é `PRODUCT_NAME = DSB`.

### Google Play
Publicado direto em produção pela conta de organização, que não exige o teste fechado com
12 testadores por 14 dias.

## Capturas de tela para as lojas

Gerar pelo site, com Chrome headless na medida da tela pedida — é mais fiel e mais rápido do
que tirar print do aparelho:

```js
await p.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 }); // iPad 13" -> 2048x2732
await p.goto('https://dsb.app.br/');
await p.screenshot({ path: 'ipad.png' });
```

- iPhone 6,5": **1242 × 2688**. iPad 13": **2048 × 2732**. Play: **1080 × 1920** (9:16).
- O iPad só é exigido porque o app é universal (`TARGETED_DEVICE_FAMILY = "1,2"`).
- Esconda o botão "Instalar aplicativo" antes do clique: é do PWA e não existe no app nativo.
- Chat e fantasy ficam com muita área vazia em tela de iPad; a home com o mapa rende melhor.

## Notificações

Pronto: Firebase criado, `google-services.json` e `GoogleService-Info.plist` nos projetos nativos,
chave APNs enviada ao Firebase, `NEXT_PUBLIC_PUSH_ENABLED=true`, Edge Function `send-push` publicada
e agendamento no banco (`cron.job` "avisos-das-provas", a cada 5 minutos).

Os segredos já estão postos e o envio foi confirmado em aparelho Android:

- Supabase → Edge Functions → Secrets: `FCM_SERVICE_ACCOUNT` (JSON da conta de serviço do
  Firebase) e `CRON_SECRET`.
- Supabase → Integrations → Vault: `cron_secret`, com **o mesmo valor** do `CRON_SECRET`.
  É por ele que o agendamento se identifica na função.

Duas armadilhas que custaram tempo: o `pg_net` instala em `net.http_post`, não em
`extensions.http_post`; e sem o `aps-environment` no `ios/App/App/App.entitlements` o iOS não
entrega notificação nenhuma, por mais certo que esteja o Firebase.

Para mandar um recado manual para todo mundo, chame a função com
`{"modo":"aviso","titulo":"...","texto":"..."}` e o cabeçalho `x-cron-secret`.
