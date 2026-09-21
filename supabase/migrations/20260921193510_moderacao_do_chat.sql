-- Moderação do chat: a organização precisa conseguir apagar mensagem de qualquer pessoa.
alter table public.profiles add column role text not null default 'user' check (role in ('user', 'moderator'));
alter table public.messages add column deleted_by uuid references auth.users(id);

-- Apagar: a própria mensagem sempre; qualquer uma se for moderador.
create or replace function public.delete_message(p_id bigint) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_paths text[]; v_uid uuid := auth.uid(); v_moderador boolean;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  select p.role = 'moderator' into v_moderador from public.profiles p where p.id = v_uid;
  update public.messages set
    deleted_at = now(), deleted_by = v_uid, body = null, file_path = null, file_name = null,
    file_type = null, file_size = null, thumb_path = null, width = null, height = null
  where id = p_id and deleted_at is null and (user_id = v_uid or coalesce(v_moderador, false))
  returning array_remove(array[file_path, thumb_path], null) into v_paths;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  delete from public.message_reactions where message_id = p_id;
  return coalesce(v_paths, '{}');
end $$;

-- A listagem passa a dizer quem apagou, para o balão distinguir os dois casos.
drop function public.chat_messages(bigint, int);
create function public.chat_messages(p_before bigint default null, p_limit int default 50)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where p_before is null or m.id < p_before
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function public.chat_messages(bigint, int) to anon, authenticated;

-- Para dar o papel a alguém:
--   update public.profiles set role = 'moderator' where id = '<uuid do usuário>';
