import type { Database } from '@/lib/database.types';
import { shortName } from '@/lib/names';

export type Reaction = { user_id: string; emoji: string };
export type Person = { id: string; name: string; avatar_url: string | null };
/** A conversa aberta: o grupo geral ou uma conversa particular com outra pessoa. */
export type Target = { kind: 'group' } | { kind: 'direct'; id: string; other: Person };
export const GROUP_KEY = 'geral';
export const targetKey = (target: Target) => target.kind === 'group' ? GROUP_KEY : target.id;
export type Row = Database['public']['Tables']['messages']['Row'];
/** Resumo da mensagem citada, como vem de chat_messages. */
export type Reply = { id: number; user_id: string; author_name: string; body: string | null; file_type: string | null; file_name: string | null; thumb_path: string | null; deleted: boolean };
/** pending: ainda enviando (relógio no lugar do ✓). localUrl: prévia do arquivo que saiu deste aparelho. */
export type Message = Row & { reactions: Reaction[]; reply: Reply | null; pending?: boolean; localUrl?: string };

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const EDIT_WINDOW = 15 * 60_000;

export const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const isVideo = (m: { file_type: string | null }) => !!m.file_type?.startsWith('video/');
export const isImage = (m: { file_type: string | null }) => !!m.file_type?.startsWith('image/');
/** Imagem precisa da miniatura (ou da prévia local); vídeo abre no player mesmo sem ela. */
export const isVisual = (m: Message) => isVideo(m) || (isImage(m) && (!!m.thumb_path || !!m.localUrl));
export const canEdit = (m: Message, userId: string | null) =>
  m.user_id === userId && !m.deleted_at && !m.pending && !!m.body && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW;

export const toReply = (m: Message): Reply => ({
  id: m.id, user_id: m.user_id, author_name: m.author_name, body: m.body, file_type: m.file_type,
  file_name: m.file_name, thumb_path: m.thumb_path, deleted: !!m.deleted_at,
});

export const authorLabel = (reply: { user_id: string; author_name: string }, userId: string | null) =>
  reply.user_id === userId ? 'Você' : shortName(reply.author_name);

/** Texto curto para a citação: o corpo, ou o tipo do anexo. */
export function replySnippet(reply: Reply) {
  if (reply.deleted) return 'Mensagem apagada';
  if (reply.body) return reply.body;
  if (isImage(reply)) return 'Foto';
  if (isVideo(reply)) return 'Vídeo';
  return reply.file_name ?? 'Arquivo';
}
