-- Conversas particulares (1 para 1), como no WhatsApp.
-- O grupo geral continua sendo as mensagens com conversation_id nulo; as particulares só são
-- lidas por quem está na conversa (RLS vale também para o Realtime).

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index conversations_user_b_idx on public.conversations(user_b);

alter table public.messages add column conversation_id uuid references public.conversations(id) on delete cascade;
create index messages_conversation_idx on public.messages(conversation_id, id desc);

-- Até onde cada pessoa leu cada conversa: é o que acende os tiques azuis.
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create function public.is_participant(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = p_conversation and (select auth.uid()) in (c.user_a, c.user_b));
$$;
-- Versão para caminhos do storage ("<conversa>/<pessoa>/..."): nunca quebra com pasta que não é uuid.
create function public.can_use_dm_path(p_name text, p_own boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.is_participant(split_part(p_name, '/', 1)::uuid)
     and (not p_own or split_part(p_name, '/', 2) = (select auth.uid())::text);
$$;

alter table public.conversations enable row level security;
alter table public.conversation_reads enable row level security;
create policy conversations_own on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy conversation_reads_participants on public.conversation_reads for select to authenticated
  using (public.is_participant(conversation_id));
grant select on public.conversations, public.conversation_reads to authenticated;

drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to anon, authenticated
  using (conversation_id is null or public.is_participant(conversation_id));
drop policy reactions_read on public.message_reactions;
create policy reactions_read on public.message_reactions for select to anon, authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

alter publication supabase_realtime add table public.conversation_reads;

-- Arquivos das conversas particulares: bucket privado, lido por link temporário.
insert into storage.buckets (id, name, public, file_size_limit)
values ('dm', 'dm', false, 52428800)
on conflict (id) do nothing;
create policy dm_read on storage.objects for select to authenticated
  using (bucket_id = 'dm' and public.can_use_dm_path(name, false));
create policy dm_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dm' and public.can_use_dm_path(name, true));
create policy dm_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'dm' and public.can_use_dm_path(name, true));

-- Abre (ou reaproveita) a conversa com outra pessoa.
create function public.start_conversation(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para conversar.' using errcode = '28000'; end if;
  if p_user is null or p_user = v_uid then raise exception 'Escolha outra pessoa para conversar.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Pessoa não encontrada.'; end if;
  insert into public.conversations (user_a, user_b) values (least(v_uid, p_user), greatest(v_uid, p_user))
  on conflict (user_a, user_b) do nothing;
  select id into v_id from public.conversations where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  return v_id;
end $$;

-- Enviar: agora também numa conversa particular. As regras do grupo valem igual.
drop function public.send_message(text, text, text, text, int, int, bigint);
create function public.send_message(
  p_body text default null,
  p_file_path text default null,
  p_thumb_path text default null,
  p_file_name text default null,
  p_width int default null,
  p_height int default null,
  p_reply_to bigint default null,
  p_conversation_id uuid default null
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

  -- Como no WhatsApp, só dá para responder a uma mensagem da mesma conversa que não foi apagada.
  if p_reply_to is not null and not exists (
    select 1 from public.messages where id = p_reply_to and deleted_at is null and conversation_id is not distinct from p_conversation_id
  ) then
    raise exception 'A mensagem que você quer responder foi apagada.';
  end if;

  -- Os arquivos precisam existir no storage, dentro da pasta da própria pessoa (e da conversa).
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

  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, reply_to, conversation_id)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end,
    p_reply_to, p_conversation_id
  )
  returning * into v_message;
  return v_message;
end $$;

-- Reagir e denunciar só valem para mensagens que a pessoa consegue ver.
create or replace function public.react_to_message(p_message_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta para reagir.' using errcode = '28000'; end if;
  if p_emoji is null then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_uid;
  else
    if not exists (
      select 1 from public.messages
      where id = p_message_id and deleted_at is null and (conversation_id is null or public.is_participant(conversation_id))
    ) then
      raise exception 'Mensagem não encontrada.';
    end if;
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, v_uid, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

create or replace function public.report_message(p_message_id bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para denunciar.' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.messages where id = p_message_id and (conversation_id is null or public.is_participant(conversation_id))
  ) then
    raise exception 'Mensagem não encontrada.';
  end if;
  insert into public.message_reports (message_id, reporter_id, reason)
  values (p_message_id, auth.uid(), left(nullif(btrim(p_reason), ''), 500))
  on conflict (message_id, reporter_id) do nothing;
end $$;

-- A listagem passa a ser por conversa (nulo = grupo geral).
drop function public.chat_messages(bigint, int);
create function public.chat_messages(p_before bigint default null, p_limit int default 50, p_conversation_id uuid default null)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, conversation_id uuid, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at, m.conversation_id,
         (select jsonb_build_object('id', q.id, 'user_id', q.user_id, 'author_name', q.author_name,
                   'body', left(q.body, 200), 'file_type', q.file_type, 'file_name', q.file_name,
                   'thumb_path', q.thumb_path, 'deleted', q.deleted_at is not null)
          from public.messages q where q.id = m.reply_to),
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where m.conversation_id is not distinct from p_conversation_id
    and (p_before is null or m.id < p_before)
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- O contador do grupo não conta mensagens particulares.
create or replace function public.unread_count(p_after bigint default 0) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.messages
  where conversation_id is null and id > coalesce(p_after, 0) and user_id is distinct from auth.uid();
$$;

-- Lista de conversas: com quem, última mensagem, não lidas e até onde a outra pessoa leu.
create function public.my_conversations()
returns table (id uuid, other_id uuid, other_name text, other_avatar text, last jsonb, unread int, other_read_id bigint)
language sql stable set search_path = '' as $$
  select c.id, o.id, o.name, o.avatar_url,
    (select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'body', left(m.body, 200), 'file_type', m.file_type,
              'file_name', m.file_name, 'created_at', m.created_at, 'deleted', m.deleted_at is not null)
       from public.messages m where m.conversation_id = c.id order by m.id desc limit 1),
    (select count(*)::int from public.messages m
       where m.conversation_id = c.id and m.user_id <> (select auth.uid())
         and m.id > coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = (select auth.uid())), 0)),
    coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = o.id), 0)
  from public.conversations c
  join public.profiles o on o.id = case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end
  where (select auth.uid()) in (c.user_a, c.user_b)
    and exists (select 1 from public.messages m where m.conversation_id = c.id);
$$;

create function public.dm_unread_count() returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(unread), 0)::int from public.my_conversations();
$$;

create function public.mark_conversation_read(p_conversation_id uuid, p_last_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_participant(p_conversation_id) then raise exception 'Conversa não encontrada.'; end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_id)
  values (p_conversation_id, auth.uid(), greatest(p_last_id, 0))
  on conflict (conversation_id, user_id) do update
    set last_read_id = greatest(public.conversation_reads.last_read_id, excluded.last_read_id), updated_at = now();
end $$;

revoke execute on function public.is_participant(uuid), public.can_use_dm_path(text, boolean) from public;
grant execute on function public.is_participant(uuid), public.can_use_dm_path(text, boolean) to anon, authenticated;
revoke execute on function public.start_conversation(uuid), public.send_message(text, text, text, text, int, int, bigint, uuid),
  public.my_conversations(), public.dm_unread_count(), public.mark_conversation_read(uuid, bigint) from public, anon;
grant execute on function public.start_conversation(uuid), public.send_message(text, text, text, text, int, int, bigint, uuid),
  public.my_conversations(), public.dm_unread_count(), public.mark_conversation_read(uuid, bigint) to authenticated;
grant execute on function public.chat_messages(bigint, int, uuid) to anon, authenticated;
