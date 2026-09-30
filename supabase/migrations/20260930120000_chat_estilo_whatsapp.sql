-- Chat com as funções principais do WhatsApp: responder citando uma mensagem e editar a própria.
alter table public.messages
  add column reply_to bigint references public.messages(id) on delete set null,
  add column edited_at timestamptz;

-- Enviar ganha a mensagem citada. Todas as regras de antes continuam iguais.
drop function public.send_message(text, text, text, text, int, int);
create function public.send_message(
  p_body text default null,
  p_file_path text default null,
  p_thumb_path text default null,
  p_file_name text default null,
  p_width int default null,
  p_height int default null,
  p_reply_to bigint default null
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_type text;
  v_size bigint;
  v_profile public.profiles;
  v_message public.messages;
begin
  if v_uid is null then raise exception 'Entre na sua conta para enviar mensagens.' using errcode = '28000'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.banned_at is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if (select count(*) from public.messages where user_id = v_uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Calma! Você está enviando mensagens rápido demais.';
  end if;
  if v_body is null and p_file_path is null then raise exception 'Mensagem vazia.'; end if;
  if v_body is not null and public.has_banned_term(v_body) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  -- Como no WhatsApp, não dá para responder a uma mensagem apagada.
  if p_reply_to is not null and not exists (select 1 from public.messages where id = p_reply_to and deleted_at is null) then
    raise exception 'A mensagem que você quer responder foi apagada.';
  end if;

  -- Os arquivos precisam existir no storage, dentro da pasta da própria pessoa.
  if p_file_path is not null then
    if split_part(p_file_path, '/', 1) <> v_uid::text then raise exception 'Arquivo inválido.'; end if;
    select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into v_type, v_size
    from storage.objects o where o.bucket_id = 'chat' and o.name = p_file_path;
    if not found then raise exception 'Arquivo não encontrado. Tente enviar de novo.'; end if;
  end if;
  if p_thumb_path is not null and (
    split_part(p_thumb_path, '/', 1) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'chat' and o.name = p_thumb_path)
  ) then raise exception 'Miniatura inválida.'; end if;

  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, reply_to)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end,
    p_reply_to
  )
  returning * into v_message;
  return v_message;
end $$;

-- Editar: só o texto da própria mensagem, nos primeiros 15 minutos (regra do WhatsApp).
create function public.edit_message(p_id bigint, p_body text) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_message public.messages;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if (select banned_at from public.profiles where id = v_uid) is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if v_body is null then raise exception 'A mensagem não pode ficar vazia.'; end if;
  if public.has_banned_term(v_body) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  select * into v_message from public.messages where id = p_id and user_id = v_uid and deleted_at is null;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  if v_message.body is null then raise exception 'Só dá para editar mensagens com texto.'; end if;
  if v_message.created_at < now() - interval '15 minutes' then
    raise exception 'Mensagens só podem ser editadas até 15 minutos depois do envio.';
  end if;
  update public.messages set body = v_body, edited_at = now() where id = p_id returning * into v_message;
  return v_message;
end $$;

-- A listagem traz a mensagem citada pronta, para o balão mostrar a citação sem outra consulta.
drop function public.chat_messages(bigint, int);
create function public.chat_messages(p_before bigint default null, p_limit int default 50)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at,
         (select jsonb_build_object('id', q.id, 'user_id', q.user_id, 'author_name', q.author_name,
                   'body', left(q.body, 200), 'file_type', q.file_type, 'file_name', q.file_name,
                   'thumb_path', q.thumb_path, 'deleted', q.deleted_at is not null)
          from public.messages q where q.id = m.reply_to),
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where p_before is null or m.id < p_before
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke execute on function public.send_message(text, text, text, text, int, int, bigint), public.edit_message(bigint, text) from public, anon;
grant execute on function public.send_message(text, text, text, text, int, int, bigint), public.edit_message(bigint, text) to authenticated;
grant execute on function public.chat_messages(bigint, int) to anon, authenticated;
