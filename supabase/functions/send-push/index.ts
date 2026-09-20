// Envia notificações pelo Firebase (FCM HTTP v1) para os aparelhos registrados.
//
// Dois modos:
//   { "modo": "provas" }                      → avisos automáticos das provas
//   { "modo": "aviso", "titulo": "...", "texto": "..." } → recado para todo mundo
//
// Segredos necessários (Supabase → Edge Functions → Secrets):
//   FCM_SERVICE_ACCOUNT  JSON da conta de serviço do Firebase
//   CRON_SECRET          valor combinado, exigido no cabeçalho x-cron-secret
import { createClient } from 'jsr:@supabase/supabase-js@2';

type ContaServico = { client_email: string; private_key: string; project_id: string };

const base64url = (dados: ArrayBuffer | string) => {
  const bytes = typeof dados === 'string' ? new TextEncoder().encode(dados) : new Uint8Array(dados);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Troca a conta de serviço por um token de acesso do Google. */
async function tokenDeAcesso(conta: ContaServico) {
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify({
    iss: conta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  }));
  const pem = conta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const chave = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(`${cabecalho}.${corpo}`));
  const jwt = `${cabecalho}.${corpo}.${base64url(assinatura)}`;

  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!resposta.ok) throw new Error(`Google recusou a conta de serviço: ${await resposta.text()}`);
  return (await resposta.json()).access_token as string;
}

/** Envia para cada aparelho e devolve os tokens que o Firebase considerou inválidos. */
async function enviar(conta: ContaServico, tokens: string[], titulo: string, texto: string) {
  const acesso = await tokenDeAcesso(conta);
  const url = `https://fcm.googleapis.com/v1/projects/${conta.project_id}/messages:send`;
  const invalidos: string[] = [];
  let enviados = 0;

  for (const token of tokens) {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${acesso}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: titulo, body: texto },
          android: { priority: 'high', notification: { channel_id: 'dsb', sound: 'default' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    });
    if (resposta.ok) { enviados++; continue; }
    // 404 e 400 costumam significar aparelho desinstalado ou token trocado.
    if (resposta.status === 404 || resposta.status === 400) invalidos.push(token);
  }
  return { enviados, invalidos };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('não autorizado', { status: 401 });
  }
  const conta = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '{}') as ContaServico;
  if (!conta.private_key) return new Response('FCM_SERVICE_ACCOUNT ausente', { status: 500 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { modo = 'provas', titulo, texto } = await req.json().catch(() => ({}));

  // Monta a lista de avisos a enviar agora.
  const avisos: { chave: string; titulo: string; texto: string }[] = [];
  if (modo === 'aviso') {
    if (!titulo || !texto) return new Response('informe titulo e texto', { status: 400 });
    avisos.push({ chave: `aviso:${Date.now()}`, titulo, texto });
  } else {
    const { data: provas } = await supabase
      .from('races')
      .select('id, number, name, starts_at')
      .gte('starts_at', new Date(Date.now() - 10 * 60_000).toISOString())
      .lte('starts_at', new Date(Date.now() + 65 * 60_000).toISOString());

    for (const prova of provas ?? []) {
      const faltam = (new Date(prova.starts_at).getTime() - Date.now()) / 60_000;
      if (faltam > 50 && faltam <= 65) {
        avisos.push({
          chave: `${prova.id}:1h`,
          titulo: `Prova ${prova.number} começa em 1 hora`,
          texto: `${prova.name}. Última chance de mudar seu fantasy.`,
        });
      } else if (faltam <= 0 && faltam > -10) {
        avisos.push({
          chave: `${prova.id}:largada`,
          titulo: `${prova.name} começou!`,
          texto: 'Acompanhe os barcos ao vivo no mapa.',
        });
      }
    }
  }
  if (avisos.length === 0) return Response.json({ enviados: 0, motivo: 'nada para avisar agora' });

  const { data: aparelhos } = await supabase.from('push_devices').select('token');
  const tokens = (aparelhos ?? []).map(a => a.token);
  const resultado: Record<string, unknown> = {};

  for (const aviso of avisos) {
    // push_log evita mandar o mesmo aviso duas vezes se o agendamento repetir.
    const { error } = await supabase.from('push_log').insert({ chave: aviso.chave, titulo: aviso.titulo });
    if (error) { resultado[aviso.chave] = 'já enviado antes'; continue; }
    const { enviados, invalidos } = await enviar(conta, tokens, aviso.titulo, aviso.texto);
    if (invalidos.length) await supabase.from('push_devices').delete().in('token', invalidos);
    resultado[aviso.chave] = { enviados, removidos: invalidos.length };
  }
  return Response.json(resultado);
});
