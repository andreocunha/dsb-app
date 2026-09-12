# DSB — Desafio Solar Brasil

Aplicação responsiva em Next.js 16, React 19 e TypeScript. Identidade roxa e amarela baseada na referência do evento. Sem login e sem banco de dados.

## Rodar

```sh
npm install
npm run dev
```

O app fica em `http://localhost:3000`. O servidor de desenvolvimento usa Turbopack. O build usa Webpack, também suportado pelo Next.js, pois o processo de CSS do Turbopack apresentou restrições no ambiente de execução.

```sh
npm run lint
npm run build
npm test
npm start
```

`npm run build` exporta as páginas para `out/` e gera o service worker com cache versionado. `npm start` serve essa pasta para conferir a versão de produção. Os testes do PWA precisam do build pronto. Node.js 22.18+ recomendado.

## Ajustar a identidade

**Todas as cores de interface estão em `app/theme.css`.**

- `:root`: cores do tema claro.
- `[data-theme="dark"]`: cores do tema escuro.
- `--brand`, `--brand-soft`, `--on-brand`: ações e destaques.
- `--accent`, `--accent-soft`, `--on-accent`: amarelo solar.
- `--background`, `--surface`, `--text`, `--border`: superfícies, textos e bordas.
- `--sidebar-*` e `--hero-*`: navegação e banner institucional.
- `--team-*`: cores ilustrativas das equipes.

O tema escolhido é salvo no navegador. Os ícones de instalação são gerados a partir do SVG em `scripts/generate-icons.mjs`; suas cores institucionais podem ser alteradas nesse script. As imagens fornecidas ficam em `public/images/event-logo.png` e `public/images/event-race.jpg`. A fotografia é a referência enviada pelo usuário, proveniente de desafiosolar.com.br. A imagem gerada durante a exploração inicial não é utilizada pelo app.

## Links do evento

Edite `lib/event-config.ts`:

- `trackingUrl`: `https://dsb-rastreio.vercel.app/`, incorporado como iframe.
- `youtubeUrl`: vazio por enquanto. Aceita URLs `youtube.com/watch?v=...`, `youtube.com/live/...` e `youtu.be/...` e converte para o player do YouTube.

Também é possível definir `NEXT_PUBLIC_YOUTUBE_LIVE_URL` em `.env.local` antes do build. Depois de mudar o link, gere um novo build. Sem link, a live mostra “A transmissão começa em breve”. Mapa e vídeo dependem de internet e da disponibilidade dos serviços externos.

## Telas

- `/`: próxima prova, resultados por etapa, mapa incorporado, live, programação e clima ilustrativo.
- `/comunidade/`: chat em grupo com mensagens locais e emojis.
- `/fantasy/`: escalação de três equipes com orçamento de 100 sóis, capitã com pontos em dobro, confirmação e ranking ilustrativo.
- `/configuracoes/`: nome, tema e preferências locais.
- Menu: bottom sheet com configurações, aparência, instalação e saída do perfil demo.

No desktop há navegação lateral; no mobile, barra fixa inferior com ícones. O layout considera `safe-area-inset` e `dvh`. Os diálogos prendem o foco, fecham com Escape e devolvem o foco ao controle que os abriu.

Resultados, programação, clima, conversa inicial e fantasy são demonstrativos. Mensagens, nome, preferências e escalação ficam em `localStorage`, com fallback em memória se o armazenamento estiver indisponível. Sair troca o perfil demo por visitante; não há autenticação. As preferências de notificação não enviam push.

## PWA

Manifesto, ícones de 192/512 px, ícone maskable, ícone Apple e cache de páginas/fontes/imagens/scripts estão incluídos. O service worker só é registrado na versão web de produção. A instalação requer HTTPS ou localhost e um navegador compatível. Após a primeira carga completa, as telas e os dados mockados ficam disponíveis offline. Conteúdos externos não são armazenados.

O cache é identificado pelo conteúdo de cada build. Uma versão nova aguarda as abas antigas fecharem antes de assumir, evitando misturar arquivos de builds diferentes. Para conferir alterações locais no PWA, feche as abas da versão anterior e abra novamente.

## Capacitor: preparar iOS e Android

A configuração está em `capacitor.config.ts`, com `webDir: 'out'`. As dependências de iOS, Android e CLI já estão instaladas. A aplicação não depende de servidor Next.js em produção. O service worker não é registrado dentro do Capacitor, que carrega os arquivos nativos empacotados.

Quando for iniciar os projetos nativos:

```sh
npm run build
npm run cap:add:ios
npm run cap:add:android
npm run cap:sync
npm run cap:ios
npm run cap:android
```

Execute os comandos `cap:add:*` apenas uma vez por plataforma. Nos próximos ciclos, use `npm run cap:sync`. É possível preparar apenas a plataforma desejada. iOS requer Xcode e Android requer Android Studio e os SDKs correspondentes.

Antes da publicação, defina o identificador definitivo do aplicativo (o atual é `br.com.desafiosolar.app`), identidade nativa, assinatura e metadados das lojas. Os projetos nativos e os binários para as lojas ainda não foram gerados. O player do YouTube deve ser validado nos aparelhos quando houver a URL real.

Referências: [exportação estática do Next.js](https://nextjs.org/docs/app/guides/static-exports), [configuração do Capacitor](https://capacitorjs.com/docs/config), [player incorporado do YouTube](https://developers.google.com/youtube/player_parameters).
