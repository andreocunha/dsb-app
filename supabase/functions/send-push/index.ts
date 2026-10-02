// Envia notificações pelo Firebase (FCM HTTP v1) para os aparelhos registrados.
//
// Três modos:
//   { "modo": "provas" }                      → avisos automáticos das provas
//   { "modo": "aviso", "titulo": "...", "texto": "..." } → recado para todo mundo
//   { "modo": "mensagem", "id": 123 }         → mensagem nova do chat: particular, grupo, resposta ou menção no grupo geral (chamado pelo gatilho do banco)
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

// O token vale 1 hora: guardado, uma mensagem que marca várias pessoas não pede um por pessoa.
let emCache: { token: string; ate: number } | null = null;
async function acessoValido(conta: ContaServico) {
  if (!emCache || emCache.ate < Date.now()) emCache = { token: await tokenDeAcesso(conta), ate: Date.now() + 50 * 60_000 };
  return emCache.token;
}

type Notificacao = {
  titulo: string;
  texto: string;
  /** Vai junto para o app: é o que diz qual conversa abrir no toque. */
  dados?: Record<string, string>;
  canal?: string;
  /** Agrupa por conversa: no Android a nova substitui a anterior; no iOS ficam empilhadas juntas. */
  grupo?: string;
};

/** Envia para cada aparelho e devolve os tokens que o Firebase considerou inválidos. */
async function enviar(conta: ContaServico, tokens: string[], aviso: Notificacao) {
  const invalidos: string[] = [];
  let enviados = 0;
  if (tokens.length === 0) return { enviados, invalidos };
  const acesso = await acessoValido(conta);
  const url = `https://fcm.googleapis.com/v1/projects/${conta.project_id}/messages:send`;

  for (const token of tokens) {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${acesso}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: aviso.titulo, body: aviso.texto },
          data: aviso.dados,
          android: { priority: 'high', notification: { channel_id: aviso.canal ?? 'dsb', sound: 'default', tag: aviso.grupo } },
          apns: { payload: { aps: { sound: 'default', 'thread-id': aviso.grupo } } },
        },
      }),
    });
    if (resposta.ok) { enviados++; continue; }
    // 404 e 400 costumam significar aparelho desinstalado ou token trocado.
    if (resposta.status === 404 || resposta.status === 400) invalidos.push(token);
  }
  return { enviados, invalidos };
}

/** Primeiro e último nome, como no chat. */
const nomeCurto = (nome: string) => {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  return partes.length < 2 ? partes[0] ?? '' : `${partes[0]} ${partes[partes.length - 1]}`;
};

const duracao = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

type Mensagem = {
  id: number; user_id: string; author_name: string; body: string | null; file_type: string | null;
  file_name: string | null; duration_ms: number | null; conversation_id: string | null; reply_to: number | null; deleted_at: string | null;
  mentions: string[] | null; mention_all: boolean | null; event: { type: string; users?: { id: string }[] } | null;
};

/** Filtro .in() com muitos ids (o @all do grupo geral) vai em partes, para a URL não estourar. */
async function emLotes<T>(ids: string[], buscar: (lote: string[]) => PromiseLike<{ data: T[] | null }>) {
  const linhas: T[] = [];
  for (let i = 0; i < ids.length; i += 150) linhas.push(...((await buscar(ids.slice(i, i + 150))).data ?? []));
  return linhas;
}

/** O que aparece na notificação, igual à prévia da lista de conversas do WhatsApp. */
function previa(m: Mensagem) {
  const texto = m.body && m.body.length > 300 ? `${m.body.slice(0, 300)}…` : m.body;
  const tipo = m.file_type ?? '';
  if (tipo.startsWith('image/')) return texto ? `📷 ${texto}` : '📷 Foto';
  if (tipo.startsWith('video/')) return texto ? `🎥 ${texto}` : '🎥 Vídeo';
  if (tipo.startsWith('audio/')) return m.duration_ms ? `🎤 Mensagem de voz (${duracao(m.duration_ms)})` : `🎵 ${m.file_name ?? 'Áudio'}`;
  if (m.file_name) return texto ? `📄 ${texto}` : `📄 ${m.file_name}`;
  return texto ?? '';
}

/**
 * Mensagem nova do chat: avisa só quem ela é para. Conversa particular → a outra pessoa;
 * grupo criado pelas pessoas → todo mundo que participa (e quem acabou de ser adicionado, no aviso de entrada);
 * grupo geral → quem foi marcado com @ (no @all, todo mundo com o app no celular) e quem escreveu a mensagem
 * respondida (um aviso só por pessoa).
 * Quem bloqueou o autor não recebe.
 */
// deno-lint-ignore no-explicit-any
async function avisarMensagem(conta: ContaServico, supabase: any, id: number) {
  const { data: m } = await supabase
    .from('messages')
    .select('id, user_id, author_name, body, file_type, file_name, duration_ms, conversation_id, reply_to, deleted_at, mentions, mention_all, event')
    .eq('id', id)
    .maybeSingle() as { data: Mensagem | null };
  if (!m || m.deleted_at) return { enviados: 0, motivo: 'mensagem não encontrada' };

  // Cada pessoa com o texto que vai receber; resposta vence menção, como no WhatsApp.
  const destinos = new Map<string, Notificacao>();
  const { data: c } = m.conversation_id
    ? await supabase.from('conversations').select('user_a, user_b, is_group, name').eq('id', m.conversation_id).maybeSingle()
    : { data: null };
  if (c?.is_group) {
    const conversa = m.conversation_id!;
    const autor = nomeCurto(m.author_name);
    if (m.event) {
      // Só quem entrou é avisado: "Fulano adicionou você".
      const texto = m.event.type === 'created' ? `${autor} criou o grupo e adicionou você` : `${autor} adicionou você`;
      for (const u of m.event.users ?? []) destinos.set(u.id, { titulo: c.name, texto, grupo: conversa });
    } else {
      const { data: participantes } = await supabase
        .from('conversation_members').select('user_id').eq('conversation_id', conversa).is('left_at', null);
      const { data: original } = m.reply_to
        ? await supabase.from('messages').select('user_id, deleted_at').eq('id', m.reply_to).maybeSingle()
        : { data: null };
      for (const p of participantes ?? []) {
        const texto = m.mention_all || (m.mentions ?? []).includes(p.user_id) ? `${autor} mencionou você: ${previa(m)}`
          : original && !original.deleted_at && original.user_id === p.user_id ? `${autor} respondeu: ${previa(m)}`
          : `${autor}: ${previa(m)}`;
        destinos.set(p.user_id, { titulo: c.name, texto, grupo: conversa });
      }
    }
  } else if (c) {
    const outra = c.user_a === m.user_id ? c.user_b : c.user_a;
    if (outra) destinos.set(outra, { titulo: nomeCurto(m.author_name), texto: previa(m), grupo: m.conversation_id! });
  } else if (!m.conversation_id) {
    // @all no grupo geral: quem tem o app instalado (só a organização consegue mandar).
    const { data: todos } = m.mention_all
      ? await supabase.from('push_devices').select('user_id').not('user_id', 'is', null)
      : { data: null };
    const marcados = new Set([...(m.mentions ?? []), ...(todos ?? []).map((d: { user_id: string }) => d.user_id)]);
    for (const uid of marcados) {
      destinos.set(uid, { titulo: 'Torcida Solar', texto: `${nomeCurto(m.author_name)} mencionou você: ${previa(m)}`, grupo: 'geral' });
    }
    if (m.reply_to) {
      const { data: original } = await supabase.from('messages').select('user_id, deleted_at').eq('id', m.reply_to).maybeSingle();
      if (original && !original.deleted_at) {
        destinos.set(original.user_id, { titulo: 'Torcida Solar', texto: `${nomeCurto(m.author_name)} respondeu: ${previa(m)}`, grupo: 'geral' });
      }
    }
  }
  destinos.delete(m.user_id);
  if (!destinos.size) return { enviados: 0, motivo: 'sem destinatário' };

  const bloqueios = await emLotes([...destinos.keys()], ids =>
    supabase.from('user_blocks').select('blocker_id').eq('blocked_id', m.user_id).in('blocker_id', ids));
  for (const b of bloqueios as { blocker_id: string }[]) destinos.delete(b.blocker_id);
  if (!destinos.size) return { enviados: 0, motivo: 'autor bloqueado' };

  const aparelhos = await emLotes([...destinos.keys()], ids => supabase.from('push_devices').select('token, user_id').in('user_id', ids));
  let enviados = 0;
  const invalidos: string[] = [];
  for (const [uid, aviso] of destinos) {
    const tokens = (aparelhos ?? []).filter((a: { user_id: string }) => a.user_id === uid).map((a: { token: string }) => a.token);
    const r = await enviar(conta, tokens, { ...aviso, canal: 'mensagens', dados: { c: aviso.grupo!, m: String(m.id) } });
    enviados += r.enviados;
    invalidos.push(...r.invalidos);
  }
  if (invalidos.length) await supabase.from('push_devices').delete().in('token', invalidos);
  return { enviados, removidos: invalidos.length };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('não autorizado', { status: 401 });
  }
  const conta = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? '{}') as ContaServico;
  if (!conta.private_key) return new Response('FCM_SERVICE_ACCOUNT ausente', { status: 500 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { modo = 'provas', titulo, texto, id } = await req.json().catch(() => ({}));

  if (modo === 'mensagem') {
    if (!Number.isInteger(id)) return new Response('informe o id da mensagem', { status: 400 });
    return Response.json(await avisarMensagem(conta, supabase, id));
  }

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
    const { enviados, invalidos } = await enviar(conta, tokens, aviso);
    if (invalidos.length) await supabase.from('push_devices').delete().in('token', invalidos);
    resultado[aviso.chave] = { enviados, removidos: invalidos.length };
  }
  return Response.json(resultado);
});
