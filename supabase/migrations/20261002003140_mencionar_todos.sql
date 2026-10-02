-- @all: marca todo mundo da conversa de uma vez, como o "@todos" do WhatsApp.
-- Não cabe em mentions (no grupo geral seriam todas as pessoas do app): fica numa coluna à parte.
-- Num grupo criado pelas pessoas qualquer participante pode usar; no grupo geral, só a organização.
alter table public.messages add column mention_all boolean not null default false;

-- Enviar: mesmo corpo da versão dos grupos, agora com o @all.
create or replace function public.send_message(
  p_body text default null,
  p_file_path text default null,
  p_thumb_path text default null,
  p_file_name text default null,
  p_width int default null,
  p_height int default null,
  p_reply_to bigint default null,
  p_conversation_id uuid default null,
  p_duration_ms int default null,
  p_waveform smallint[] default null,
  p_mentions uuid[] default null
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
  v_mentions uuid[] := '{}';
  v_all boolean := false;
  v_message public.messages;
begin
  if v_uid is null then raise exception 'Entre na sua conta para enviar mensagens.' using errcode = '28000'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.banned_at is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  -- Os avisos do grupo (adicionou, removeu...) não contam no limite.
  if (select count(*) from public.messages where user_id = v_uid and event is null and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Calma! Você está enviando mensagens rápido demais.';
  end if;
  if v_body is null and p_file_path is null then raise exception 'Mensagem vazia.'; end if;
  if v_body is not null and public.has_banned_term(v_body) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;

  if p_conversation_id is not null then
    select * into v_conversation from public.conversations where id = p_conversation_id;
    if not found or not public.is_participant(p_conversation_id) then
      raise exception '%', case when v_conversation.is_group then 'Você não participa deste grupo.' else 'Conversa não encontrada.' end;
    end if;
    if not v_conversation.is_group then
      v_other := case when v_conversation.user_a = v_uid then v_conversation.user_b else v_conversation.user_a end;
      if exists (select 1 from public.user_blocks where blocker_id = v_uid and blocked_id = v_other) then
        raise exception 'Você bloqueou esta pessoa. Desbloqueie para mandar mensagens.';
      end if;
      if exists (select 1 from public.user_blocks where blocker_id = v_other and blocked_id = v_uid) then
        raise exception 'Não foi possível enviar a mensagem.';
      end if;
    end if;
    v_bucket := 'dm';
    v_folder := p_conversation_id::text || '/' || v_uid::text;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to and deleted_at is null and event is null and conversation_id is not distinct from p_conversation_id
      and (p_conversation_id is null or public.can_read_message(p_conversation_id, id))
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

  -- Menções (grupo geral e grupos): o app manda quem foi escolhido na lista do @; aqui só fica quem está
  -- mesmo no texto e, num grupo, quem participa dele.
  if (p_conversation_id is null or v_conversation.is_group) and v_body is not null and p_mentions is not null then
    select coalesce(array_agg(p.id), '{}') into v_mentions
    from (select distinct unnest(p_mentions[1:50]) as id) x
    join public.profiles p on p.id = x.id
    cross join lateral (select regexp_split_to_array(btrim(p.name), '\s+') as parts) n
    where p.id <> v_uid and p.banned_at is null
      and (p_conversation_id is null or exists (
        select 1 from public.conversation_members m where m.conversation_id = p_conversation_id and m.user_id = p.id and m.left_at is null))
      and (
        strpos(lower(v_body), lower('@' || btrim(p.name))) > 0
        or strpos(lower(v_body), lower('@' || n.parts[1] || case when cardinality(n.parts) > 1 then ' ' || n.parts[cardinality(n.parts)] else '' end)) > 0
      );
  end if;

  -- @all como palavra solta no texto. No grupo geral só a organização marca todo mundo.
  v_all := v_body is not null and v_body ~* '(^|[^[:alnum:]_])@all([^[:alnum:]_]|$)'
    and (v_conversation.is_group or (p_conversation_id is null and v_profile.role = 'moderator'));

  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, reply_to, conversation_id, duration_ms, waveform, mentions, mention_all)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end,
    p_reply_to, p_conversation_id,
    case when v_voice then p_duration_ms end,
    case when v_voice then (select array_agg(least(greatest(coalesce(v, 0), 0), 100)::smallint) from unnest(p_waveform[1:100]) v) end,
    v_mentions, coalesce(v_all, false)
  )
  returning * into v_message;
  return v_message;
end $$;

-- A listagem traz o @all.
drop function public.chat_messages(bigint, int, uuid);
create function public.chat_messages(p_before bigint default null, p_limit int default 50, p_conversation_id uuid default null)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, conversation_id uuid, duration_ms int, waveform smallint[], mentions uuid[], mention_all boolean, event jsonb,
  played_by_me boolean, played_by_others boolean, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at, m.conversation_id, m.duration_ms, m.waveform, m.mentions, m.mention_all, m.event,
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

-- Menções a você no grupo geral: o @all de outra pessoa também conta.
create or replace function public.my_mentions(p_after bigint default 0) returns bigint[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(m.id order by m.id), '{}') from public.messages m
  where m.conversation_id is null and m.deleted_at is null and m.id > coalesce(p_after, 0)
    and ((select auth.uid()) = any (m.mentions) or (m.mention_all and m.user_id <> (select auth.uid())))
    and not exists (select 1 from public.user_blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = m.user_id);
$$;
create index messages_mention_all_idx on public.messages (id) where mention_all and conversation_id is null and deleted_at is null;

-- Lista de conversas: o @ verde dos grupos conta também o @all de outra pessoa.
create or replace function public.my_conversations()
returns table (
  id uuid, is_group boolean, other_id uuid, other_name text, other_avatar text, name text, photo_path text, description text,
  last jsonb, unread int, mentions int, other_read_id bigint, other_delivered_id bigint
)
language sql stable set search_path = '' as $$
  with mine as (
    select c.*, coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = (select auth.uid())), 0) as my_read
    from public.conversations c
    where (select auth.uid()) in (c.user_a, c.user_b)
       or exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = (select auth.uid()) and m.left_at is null)
  ),
  -- Quem mais está na conversa: a outra pessoa da particular, ou os outros participantes do grupo.
  others as (
    select c.id as conversation_id, x.user_id from mine c
    cross join lateral (
      select case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end as user_id where not c.is_group
      union all
      select m.user_id from public.conversation_members m
      where c.is_group and m.conversation_id = c.id and m.left_at is null and m.user_id <> (select auth.uid())
    ) x
  )
  select c.id, c.is_group, o.id, o.name, o.avatar_url, c.name, c.photo_path, c.description,
    (select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'author_name', m.author_name, 'body', left(m.body, 200), 'file_type', m.file_type,
              'file_name', m.file_name, 'created_at', m.created_at, 'deleted', m.deleted_at is not null, 'duration_ms', m.duration_ms, 'event', m.event)
       from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
    (select count(*)::int from public.messages m
       where m.conversation_id = c.id and m.user_id <> (select auth.uid()) and m.id > c.my_read),
    (select count(*)::int from public.messages m
       where c.is_group and m.conversation_id = c.id and m.id > c.my_read and m.deleted_at is null
         and ((select auth.uid()) = any (m.mentions) or (m.mention_all and m.user_id <> (select auth.uid())))),
    coalesce((select min(coalesce(r.last_read_id, 0)) from others x
              left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = x.user_id
              where x.conversation_id = c.id), 0),
    coalesce((select min(coalesce(greatest(r.last_delivered_id, r.last_read_id), 0)) from others x
              left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = x.user_id
              where x.conversation_id = c.id), 0)
  from mine c
  left join public.profiles o on not c.is_group and o.id = case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end
  where exists (select 1 from public.messages m where m.conversation_id = c.id);
$$;

-- Notificação: o @all no grupo geral também chama a send-push (que avisa todo mundo).
create or replace function public.avisar_mensagem_nova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_segredo text;
begin
  if new.conversation_id is null and new.reply_to is null and cardinality(new.mentions) = 0 and not new.mention_all then return new; end if;
  if new.event is not null and new.event->>'type' not in ('created', 'added') then return new; end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cron_secret';
  if v_segredo is null then
    raise warning 'Notificação não enviada: crie o segredo cron_secret no Vault.';
    return new;
  end if;
  perform net.http_post(
    url := 'https://ztzmvdmggxyokfbakajq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_segredo),
    body := jsonb_build_object('modo', 'mensagem', 'id', new.id)
  );
  return new;
exception when others then
  -- Problema na notificação nunca pode impedir a mensagem de ser enviada.
  raise warning 'Notificação não enviada: %', sqlerrm;
  return new;
end $$;

grant execute on function public.chat_messages(bigint, int, uuid) to anon, authenticated;
