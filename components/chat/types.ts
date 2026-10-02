import type { Database } from '@/lib/database.types';
import { asPlace, placeLabel, type LivePosition } from '@/lib/location';
import { shortName } from '@/lib/names';
import { formatDuration } from '@/lib/voice';

export type Reaction = { user_id: string; emoji: string };
export type Person = { id: string; name: string; avatar_url: string | null };
/** Grupo criado pelas pessoas: nome, foto (no bucket privado) e descrição. */
export type GroupInfo = { name: string; photo_path: string | null; description: string | null };
/** A conversa aberta: o grupo geral, uma conversa particular ou um grupo criado pelas pessoas. */
export type Target = { kind: 'general' } | { kind: 'direct'; id: string; other: Person } | { kind: 'group'; id: string; group: GroupInfo };
export const GROUP_KEY = 'geral';
export const targetKey = (target: Target) => target.kind === 'general' ? GROUP_KEY : target.id;
/** Participante de um grupo, como vem de group_members. */
export type Member = Person & { admin: boolean };
export const MAX_GROUP = 256;
export type Row = Database['public']['Tables']['messages']['Row'];
/** Aviso no meio do grupo ("Fulano adicionou Ciclano"), salvo em messages.event. */
export type GroupEvent = { type: 'created' | 'added' | 'removed' | 'left' | 'renamed' | 'description' | 'photo'; users?: { id: string; name: string }[]; name?: string };
/** Resumo da mensagem citada, como vem de chat_messages. */
export type Reply = { id: number; user_id: string; author_name: string; body: string | null; file_type: string | null; file_name: string | null; thumb_path: string | null; duration_ms?: number | null; location?: unknown; deleted: boolean };
/**
 * pending: ainda enviando (relógio no lugar do ✓). localUrl: prévia do arquivo que saiu deste aparelho.
 * live: onde quem compartilha a localização em tempo real está agora.
 */
export type Message = Row & { reactions: Reaction[]; reply: Reply | null; pending?: boolean; localUrl?: string; played_by_me?: boolean; played_by_others?: boolean; live?: LivePosition | null };
/** Microfone da mensagem de voz: verde (você ainda não ouviu), cinza (enviada) ou azul (ouvida). */
export type Played = 'new' | 'sent' | 'played';

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const EDIT_WINDOW = 15 * 60_000;

export const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const isVideo = (m: { file_type: string | null }) => !!m.file_type?.startsWith('video/');
export const isImage = (m: { file_type: string | null }) => !!m.file_type?.startsWith('image/');
export const isAudio = (m: { file_type: string | null }) => !!m.file_type?.startsWith('audio/');
export const isLocation = (m: { location?: unknown }) => !!asPlace(m.location);
/** Imagem precisa da miniatura (ou da prévia local); vídeo abre no player mesmo sem ela. */
export const isVisual = (m: Message) => isVideo(m) || (isImage(m) && (!!m.thumb_path || !!m.localUrl));
export const canEdit = (m: Message, userId: string | null) =>
  m.user_id === userId && !m.deleted_at && !m.pending && !!m.body && !isLocation(m) && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW;

export const toReply = (m: Message): Reply => ({
  id: m.id, user_id: m.user_id, author_name: m.author_name, body: m.body, file_type: m.file_type,
  file_name: m.file_name, thumb_path: m.thumb_path, duration_ms: m.duration_ms, location: m.location, deleted: !!m.deleted_at,
});

export const authorLabel = (reply: { user_id: string; author_name: string }, userId: string | null) =>
  reply.user_id === userId ? 'Você' : shortName(reply.author_name);

/** Texto curto para a citação: o corpo, ou o tipo do anexo. */
export function replySnippet(reply: Reply) {
  if (reply.deleted) return 'Mensagem apagada';
  if (reply.body) return reply.body;
  if (isLocation(reply)) return placeLabel(asPlace(reply.location));
  if (isImage(reply)) return 'Foto';
  if (isVideo(reply)) return 'Vídeo';
  if (isAudio(reply)) return reply.duration_ms ? `Mensagem de voz (${formatDuration(reply.duration_ms)})` : reply.file_name ?? 'Áudio';
  return reply.file_name ?? 'Arquivo';
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e Carla"; com muita gente, "Ana, Bruno, Carla e mais 5 pessoas". */
export function listNames(names: string[]) {
  if (names.length > 4) return `${names.slice(0, 3).join(', ')} e mais ${names.length - 3} pessoas`;
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Texto do aviso, do jeito do WhatsApp: "Você adicionou Ana e Bruno", "Carlos saiu". */
export function eventText(event: GroupEvent, actor: { user_id: string; author_name: string }, userId: string | null) {
  const me = actor.user_id === userId;
  const who = me ? 'Você' : shortName(actor.author_name);
  // Você vem primeiro na lista, como no WhatsApp.
  const list = event.users ?? [];
  const users = listNames([...list.filter(u => u.id === userId).map(() => 'você'), ...list.filter(u => u.id !== userId).map(u => shortName(u.name))]);
  switch (event.type) {
    case 'created': return `${who} criou o grupo "${event.name ?? ''}"${!me && list.some(u => u.id === userId) ? ' e adicionou você' : ''}`;
    case 'added': return `${who} adicionou ${users}`;
    case 'removed': return `${who} removeu ${users}`;
    case 'left': return `${who} saiu`;
    case 'renamed': return `${who} mudou o nome do grupo para "${event.name ?? ''}"`;
    case 'description': return `${who} mudou a descrição do grupo`;
    case 'photo': return `${who} mudou a foto do grupo`;
  }
}
