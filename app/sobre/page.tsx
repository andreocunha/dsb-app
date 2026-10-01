import Link from 'next/link';

// Página de apresentação do app. É a "página inicial" cadastrada na tela de consentimento do
// Google: a home do site é o próprio app (o mapa ao vivo), sem texto dizendo o que ele é nem
// link visível para a política de privacidade, e a verificação da marca não passa com ela.
export const metadata = {
  title: 'Sobre o app',
  description: 'DSB é o aplicativo oficial de acompanhamento do Desafio Solar Brasil: mapa ao vivo das provas, resultados, chat da torcida e fantasy.',
};

const lojas = {
  ios: 'https://apps.apple.com/br/app/id6814861339',
  android: 'https://play.google.com/store/apps/details?id=br.com.desafiosolar.app',
};

export default function Page() {
  return <div className="page legal">
    <div className="page-heading"><div>
      <h1>Desafio Solar Brasil</h1>
      <p>O aplicativo para acompanhar a competição de barcos movidos a energia solar.</p>
    </div></div>
    <section className="card prose">
      <p>O DSB reúne tudo do Desafio Solar Brasil em um lugar só, no celular ou no computador:</p>
      <ul>
        <li><strong>Mapa ao vivo:</strong> a posição de cada barco durante as provas, com o percurso e a chegada.</li>
        <li><strong>Resultados:</strong> a classificação de cada prova e a geral, com artes prontas para compartilhar.</li>
        <li><strong>Transmissão:</strong> a live do evento dentro do app.</li>
        <li><strong>Chat da torcida:</strong> conversa entre equipes e torcedores, com moderação, denúncia e bloqueio.</li>
        <li><strong>Fantasy:</strong> monte sua equipe de barcos e dispute com os amigos.</li>
      </ul>
      <p>Navegar é livre. Para escrever no chat e jogar o fantasy, você entra com a sua conta Google ou Apple; o app usa apenas seu nome, foto e e-mail para identificar a conta.</p>

      <h2>Baixe o app</h2>
      <p><a className="text-link" href={lojas.ios}>App Store (iPhone)</a> · <a className="text-link" href={lojas.android}>Google Play (Android)</a> · <Link className="text-link" href="/">Abrir no navegador</Link></p>

      <h2>Privacidade e termos</h2>
      <p><Link className="text-link" href="/privacidade/">Política de privacidade</Link> · <Link className="text-link" href="/termos/">Termos de uso</Link></p>

      <h2>Contato</h2>
      <p><a className="text-link" href="mailto:andreoliveiracunha20@gmail.com">andreoliveiracunha20@gmail.com</a></p>
    </section>
  </div>;
}
