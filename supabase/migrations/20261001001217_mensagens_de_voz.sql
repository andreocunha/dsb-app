-- Mensagens de voz, como no WhatsApp: o áudio vai como arquivo (mesmo storage das fotos),
-- com a duração e a forma de onda gravadas junto, e cada "tocou" vira o microfone azul.
alter table public.messages
  add column duration_ms int check (duration_ms is null or duration_ms between 1 and 3600000),
  add column waveform smallint[] check (waveform is null or cardinality(waveform) <= 100);

-- Quem já ouviu cada mensagem de voz.
create table public.message_plays (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  played_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_plays enable row level security;
-- Vê quem pode ver a mensagem (grupo: todos; particular: as duas pessoas).
create policy message_plays_read on public.message_plays for select to anon, authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));
grant select on public.message_plays to anon, authenticated;
alter publication supabase_realtime add table public.message_plays;

create function public.mark_played(p_message_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.message_plays (message_id, user_id)
  select m.id, v_uid from public.messages m
  where m.id = p_message_id and m.user_id <> v_uid and m.deleted_at is null and m.duration_ms is not null
    and (m.conversation_id is null or public.is_participant(m.conversation_id))
  on conflict do nothing;
end $$;

-- Enviar ganha a duração e a forma de onda (só para áudio).
drop function public.send_message(text, text, text, text, int, int, bigint, uuid);
create function public.send_message(
  p_body text default null,
  p_file_path text default null,
  p_thumb_path text default null,
  p_file_name text default null,
  p_width int default null,
  p_height int default null,
  p_reply_to bigint default null,
  p_conversation_id uuid default null,
  p_duration_ms int default null,
  p_waveform smallint[] default null
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_type text;
  v_size bigint;
  v_profile public.profiles;
  v_conversation public.conversations;
  v_other uuid;
  v_bucket text := 'chat';
  v_folder text := v_uid::text;
  v_voice boolean;
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

  if p_conversation_id is not null then
    select * into v_conversation from public.conversations where id = p_conversation_id and v_uid in (user_a, user_b);
    if not found then raise exception 'Conversa não encontrada.'; end if;
    v_other := case when v_conversation.user_a = v_uid then v_conversation.user_b else v_conversation.user_a end;
    if exists (select 1 from public.user_blocks where blocker_id = v_uid and blocked_id = v_other) then
      raise exception 'Você bloqueou esta pessoa. Desbloqueie para mandar mensagens.';
    end if;
    if exists (select 1 from public.user_blocks where blocker_id = v_other and blocked_id = v_uid) then
      raise exception 'Não foi possível enviar a mensagem.';
    end if;
    v_bucket := 'dm';
    v_folder := p_conversation_id::text || '/' || v_uid::text;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages where id = p_reply_to and deleted_at is null and conversation_id is not distinct from p_conversation_id
  ) then
    raise exception 'A mensagem que você quer responder foi apagada.';
  end if;

  if p_file_path is not null then
    if p_file_path not like v_folder || '/%' then raise exception 'Arquivo inválido.'; end if;
    select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into v_type, v_size
    from storage.objects o where o.bucket_id = v_bucket and o.name = p_file_path;
    if not found then raise exception 'Arquivo não encontrado. Tente enviar de novo.'; end if;
  end if;
  if p_thumb_path is not null and (
    p_thumb_path not like v_folder || '/%'
    or not exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = p_thumb_path)
  ) then raise exception 'Miniatura inválida.'; end if;

  -- Mensagem de voz: arquivo de áudio com duração; a forma de onda vai de 0 a 100.
  v_voice := p_duration_ms is not null;
  if v_voice and (v_type is null or v_type not like 'audio/%' or p_duration_ms not between 1 and 3600000) then
    raise exception 'Áudio inválido. Tente gravar de novo.';
  end if;

  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, reply_to, conversation_id, duration_ms, waveform)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end,
    p_reply_to, p_conversation_id,
    case when v_voice then p_duration_ms end,
    case when v_voice then (select array_agg(least(greatest(coalesce(v, 0), 0), 100)::smallint) from unnest(p_waveform[1:100]) v) end
  )
  returning * into v_message;
  return v_message;
end $$;

-- A listagem traz a duração, a forma de onda e o "tocou" (meu e dos outros).
drop function public.chat_messages(bigint, int, uuid);
create function public.chat_messages(p_before bigint default null, p_limit int default 50, p_conversation_id uuid default null)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, conversation_id uuid, duration_ms int, waveform smallint[],
  played_by_me boolean, played_by_others boolean, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at, m.conversation_id, m.duration_ms, m.waveform,
         exists (select 1 from public.message_plays p where p.message_id = m.id and p.user_id = (select auth.uid())),
         exists (select 1 from public.message_plays p where p.message_id = m.id and p.user_id <> m.user_id),
         (select jsonb_build_object('id', q.id, 'user_id', q.user_id, 'author_name', q.author_name,
                   'body', left(q.body, 200), 'file_type', q.file_type, 'file_name', q.file_name,
                   'thumb_path', q.thumb_path, 'duration_ms', q.duration_ms, 'deleted', q.deleted_at is not null)
          from public.messages q where q.id = m.reply_to),
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where m.conversation_id is not distinct from p_conversation_id
    and (p_before is null or m.id < p_before)
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Lista de conversas: a prévia do áudio mostra a duração e o microfone (verde ou azul).
drop function public.my_conversations();
create function public.my_conversations()
returns table (id uuid, other_id uuid, other_name text, other_avatar text, last jsonb, unread int, other_read_id bigint, other_delivered_id bigint)
language sql stable set search_path = '' as $$
  select c.id, o.id, o.name, o.avatar_url,
    (select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'body', left(m.body, 200), 'file_type', m.file_type,
              'file_name', m.file_name, 'created_at', m.created_at, 'deleted', m.deleted_at is not null,
              'duration_ms', m.duration_ms,
              'played', exists (select 1 from public.message_plays p where p.message_id = m.id
                                  and p.user_id = case when m.user_id = (select auth.uid()) then o.id else (select auth.uid()) end))
       from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
    (select count(*)::int from public.messages m
       where m.conversation_id = c.id and m.user_id <> (select auth.uid())
         and m.id > coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = (select auth.uid())), 0)),
    coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = o.id), 0),
    coalesce((select greatest(r.last_delivered_id, r.last_read_id) from public.conversation_reads r where r.conversation_id = c.id and r.user_id = o.id), 0)
  from public.conversations c
  join public.profiles o on o.id = case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end
  where (select auth.uid()) in (c.user_a, c.user_b)
    and exists (select 1 from public.messages m where m.conversation_id = c.id);
$$;

revoke execute on function public.mark_played(bigint), public.my_conversations(),
  public.send_message(text, text, text, text, int, int, bigint, uuid, int, smallint[]) from public, anon;
grant execute on function public.mark_played(bigint), public.my_conversations(),
  public.send_message(text, text, text, text, int, int, bigint, uuid, int, smallint[]) to authenticated;
grant execute on function public.chat_messages(bigint, int, uuid) to anon, authenticated;
