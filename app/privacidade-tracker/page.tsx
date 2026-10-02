export const metadata = { title: 'Privacidade · DSB Tracker' };

const contato = 'andreoliveiracunha20@gmail.com';

export default function Page() {
  return <div className="page legal">
    <div className="page-heading"><div><h1>Política de privacidade · DSB Tracker</h1><p>Última atualização: 1º de outubro de 2026.</p></div></div>
    <section className="card prose">
      <p>O DSB Tracker é o aplicativo para Android e iPhone usado pelas equipes do Desafio Solar Brasil para enviar a posição dos barcos durante a competição e pedir socorro (SOS) à organização. Esta página explica quais dados ele coleta e como são usados.</p>

      <h2>Sem conta e sem login</h2>
      <p>O aplicativo não pede nome, e-mail, telefone nem qualquer conta. Na primeira abertura ele gera um identificador aleatório e uma credencial guardados só no aparelho. O código curto mostrado na tela serve para a organização vincular o celular ao barco de uma equipe.</p>

      <h2>O que coletamos</h2>
      <ul>
        <li><strong>Localização precisa:</strong> latitude, longitude, precisão, velocidade e direção, com data e hora. A coleta só acontece enquanto o tracker está ligado, o que exige uma ação manual do piloto a cada viagem, e continua com a tela apagada ou bloqueada enquanto a viagem estiver ativa (no Android, com a notificação do tracker visível; no iPhone, com o indicador de localização do sistema).</li>
        <li><strong>Pedidos de SOS:</strong> o horário e a posição no momento do pedido.</li>
        <li><strong>Identificador do aparelho no app:</strong> o identificador aleatório descrito acima. Não usamos o IMEI, o ID de publicidade nem outros identificadores do sistema.</li>
      </ul>
      <p>Com o tracker desligado, nenhuma localização é coletada.</p>

      <h2>Para que usamos</h2>
      <p>As posições alimentam o mapa ao vivo da competição, no site e no app do DSB, e o acompanhamento da prova pela organização. Os pedidos de SOS vão para a equipe de apoio do evento. O histórico de posições pode ser usado para reconstituir as provas. Não usamos os dados para publicidade, não rastreamos você em outros aplicativos e não vendemos dados.</p>

      <h2>Com quem compartilhamos</h2>
      <p>A posição de cada barco é pública no mapa da competição, associada ao nome da equipe. Os dados são processados pelo nosso servidor (Render) e guardados no Supabase. Não há outro compartilhamento com terceiros.</p>

      <h2>Segurança e retenção</h2>
      <p>Todo envio usa conexão criptografada (HTTPS). Sem internet, as posições ficam numa fila no próprio aparelho até serem enviadas. Os dados ficam guardados enquanto forem necessários ao registro e à reconstituição das provas, e podem ser apagados a qualquer momento a seu pedido.</p>

      <h2>Seus direitos e exclusão</h2>
      <p>Desinstalar o aplicativo apaga do aparelho as posições ainda não enviadas. No Android, apaga também o identificador; no iPhone, ele fica guardado no Keychain do aparelho para manter o vínculo com o barco se o app for reinstalado. Para apagar os dados já recebidos pelo servidor, envie o código mostrado no app para o e-mail abaixo.</p>

      <h2>Crianças</h2>
      <p>O aplicativo é destinado aos participantes da competição e não é voltado a menores de 13 anos.</p>

      <h2>Contato</h2>
      <p>Dúvidas ou pedidos de exclusão: <a className="text-link" href={`mailto:${contato}`}>{contato}</a>.</p>
    </section>
  </div>;
}
