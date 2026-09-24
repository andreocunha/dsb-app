export const metadata = { title: 'Termos de uso' };

const contato = 'andreoliveiracunha20@gmail.com';

export default function Page() {
  return <div className="page legal">
    <div className="page-heading"><div><h1>Termos de uso</h1><p>Última atualização: 24 de setembro de 2026.</p></div></div>
    <section className="card prose">
      <p>Estes termos valem para quem usa o DSB, o aplicativo do Desafio Solar Brasil. Ao entrar na sua conta você concorda com eles. Navegar pelo aplicativo continua livre e não exige conta.</p>

      <h2>Tolerância zero com conteúdo ofensivo</h2>
      <p><strong>Não existe tolerância com conteúdo ofensivo nem com pessoas abusivas.</strong> É proibido publicar no chat, em texto, foto, vídeo ou arquivo:</p>
      <ul>
        <li>ofensa, ameaça, assédio, perseguição ou incitação à violência;</li>
        <li>racismo, homofobia, transfobia, machismo, xenofobia ou qualquer discurso de ódio;</li>
        <li>conteúdo sexual, nudez ou material que envolva menores de idade;</li>
        <li>conteúdo ilegal, golpe, spam, propaganda ou divulgação de dados pessoais de outra pessoa;</li>
        <li>fazer-se passar por outra pessoa ou pela organização do evento.</li>
      </ul>

      <h2>O que acontece com quem quebra a regra</h2>
      <p>A organização remove o conteúdo denunciado e <strong>bane a conta responsável</strong>. Uma conta banida continua podendo ver o evento, mas não escreve mais no chat. Não há aviso prévio nem direito a recurso para casos graves.</p>
      <p><strong>Analisamos toda denúncia em até 24 horas.</strong></p>

      <h2>O que você pode fazer</h2>
      <ul>
        <li><strong>Denunciar:</strong> toque na mensagem e escolha denunciar. A organização recebe na hora.</li>
        <li><strong>Bloquear:</strong> toque na mensagem e bloqueie quem escreveu. As mensagens dessa pessoa somem do seu chat na mesma hora, e a organização é avisada.</li>
        <li><strong>Sair:</strong> em <strong>Configurações → Sua conta → Excluir conta</strong> você apaga perfil, mensagens e arquivos de uma vez.</li>
      </ul>

      <h2>Filtro automático</h2>
      <p>O chat recusa automaticamente mensagens com termos ofensivos conhecidos. O filtro é um apoio, não substitui a análise das denúncias.</p>

      <h2>O conteúdo que você envia</h2>
      <p>O que você escreve e envia continua seu. Ao publicar no chat, você autoriza o aplicativo a exibir esse conteúdo para as outras pessoas do evento, e garante que tem o direito de publicá-lo. Mensagens e arquivos do chat são públicos dentro do aplicativo.</p>

      <h2>Idade mínima</h2>
      <p>O aplicativo não é destinado a menores de 13 anos.</p>

      <h2>Sem garantias</h2>
      <p>O DSB acompanha um evento esportivo e é oferecido como está. Posições, horários e resultados podem mudar ou falhar, e não servem para navegação nem para decisão de segurança.</p>

      <h2>Contato</h2>
      <p>Denúncias, dúvidas ou pedidos de exclusão: <a className="text-link" href={`mailto:${contato}`}>{contato}</a>. Respondemos denúncias em até 24 horas.</p>
    </section>
  </div>;
}
