export const metadata = { title: 'Privacidade' };

const contato = 'andreoliveiracunha20@gmail.com';

export default function Page() {
  return <div className="page legal">
    <div className="page-heading"><div><h1>Política de privacidade</h1><p>Última atualização: 20 de setembro de 2026.</p></div></div>
    <section className="card prose">
      <p>O DSB é o aplicativo do Desafio Solar Brasil. Ele mostra a competição, um chat da torcida e um jogo de fantasy. Esta página explica quais dados ele guarda e o que você pode fazer com eles.</p>

      <h2>Navegar não exige conta</h2>
      <p>O mapa, os resultados, a transmissão e a leitura do chat funcionam sem login. Só é preciso entrar para escrever no chat, reagir a mensagens e montar seu fantasy.</p>

      <h2>O que guardamos quando você entra</h2>
      <ul>
        <li><strong>Seu perfil:</strong> nome e foto vindos da conta Google ou Apple que você escolher, e seu e-mail, usado apenas para identificar a conta.</li>
        <li><strong>Chat:</strong> as mensagens e os arquivos que você enviar, com data e hora, além das suas reações, denúncias e bloqueios.</li>
        <li><strong>Fantasy:</strong> os barcos escolhidos em cada prova e a sua pontuação.</li>
        <li><strong>Notificações:</strong> no aplicativo das lojas, um identificador do aparelho, para enviar avisos do evento.</li>
      </ul>
      <p>Não usamos publicidade, não rastreamos você em outros aplicativos e não vendemos seus dados.</p>

      <h2>Onde os dados ficam</h2>
      <p>Os dados ficam no Supabase, em servidores no Brasil, e o aplicativo é servido pela Vercel. Mensagens e arquivos do chat são públicos dentro do aplicativo: qualquer pessoa que abrir o chat pode vê-los.</p>

      <h2>Excluir sua conta</h2>
      <p>Em <strong>Configurações → Sua conta → Excluir conta</strong> você apaga tudo de uma vez: perfil, mensagens, arquivos enviados, reações e escalações. A ação é imediata e não dá para desfazer. Se preferir, peça pelo e-mail abaixo.</p>

      <h2>Conteúdo do chat</h2>
      <p>Toque em uma mensagem para denunciá-la ou bloquear quem a escreveu. Denúncias são revisadas pela organização e mensagens que quebrem as regras podem ser removidas.</p>

      <h2>Crianças</h2>
      <p>O aplicativo não é destinado a menores de 13 anos.</p>

      <h2>Contato</h2>
      <p>Dúvidas, pedidos de exclusão ou denúncias: <a className="text-link" href={`mailto:${contato}`}>{contato}</a>.</p>
    </section>
  </div>;
}
