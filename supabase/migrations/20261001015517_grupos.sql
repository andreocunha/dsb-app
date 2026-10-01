-- Grupos criados pelas pessoas, como no WhatsApp: nome, foto, descrição, participantes e admins.
-- Um grupo é uma conversa com is_group, e quem participa fica em conversation_members.
-- Tudo o que já valia para as particulares (bucket privado "dm", não lidas, tiques, Realtime com RLS)
-- passa a valer para os grupos pelo is_participant.

alter table public.conversations
  alter column user_a drop not null,
  alter column user_b drop not null,
  add column is_group boolean not null default false,
  add column name text,
  add column description text,
  add column photo_path text,
  add column created_by uuid references auth.users(id) on delete set null,
  add constraint conversations_kind check (case when is_group
    then user_a is null and user_b is null and char_length(btrim(name)) between 1 and 100 and coalesce(char_length(description), 0) <= 512
    else user_a is not null and user_b is not null and name is null and description is null and photo_path is null
  end);
create index conversations_created_by_idx on public.conversations(created_by, created_at desc) where is_group;

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  admin boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  -- Como no WhatsApp, quem entra não vê o que foi falado antes: só as mensagens depois desta.
  since_id bigint not null default 0,
  -- Quem sai ou é removido fica com left_at: é assim que o app da pessoa fica sabendo na hora.
  left_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id) where left_at is null;

-- Avisos no meio da conversa ("Fulano adicionou Ciclano"): o app monta o texto, com "Você", a partir do evento.
alter table public.messages
  add column event jsonb check (event is null or event->>'type' in ('created', 'added', 'removed', 'left', 'renamed', 'description', 'photo'));
alter table public.messages drop constraint messages_check;
alter table public.messages add constraint messages_check
  check (deleted_at is not null or body is not null or file_path is not null or event is not null);

-- Participa: as duas pessoas da particular, ou quem está no grupo agora.
create or replace function public.is_participant(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = p_conversation and (select auth.uid()) in (c.user_a, c.user_b))
      or exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conversation and m.user_id = (select auth.uid()) and m.left_at is null);
$$;

-- Ler uma mensagem: na particular, as duas pessoas; no grupo, quem participa e só do que chegou depois que entrou.
create function public.can_read_message(p_conversation uuid, p_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = p_conversation and (select auth.uid()) in (c.user_a, c.user_b))
      or exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conversation and m.user_id = (select auth.uid()) and m.left_at is null and p_id > m.since_id);
$$;

create function public.is_group_admin(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = p_conversation and m.user_id = (select auth.uid()) and m.left_at is null and m.admin);
$$;

drop policy conversations_own on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (public.is_participant(id));

drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to anon, authenticated
  using (conversation_id is null or public.can_read_message(conversation_id, id));

alter table public.conversation_members enable row level security;
-- A própria linha continua visível depois de sair: é ela que avisa o app que a pessoa saiu.
create policy conversation_members_read on public.conversation_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_participant(conversation_id));
grant select on public.conversation_members to authenticated;

-- Tempo real: nome e foto do grupo mudando, e quem entra, sai ou vira admin.
alter publication supabase_realtime add table public.conversations, public.conversation_members;

-- Grupo nunca fica sem admin: quem saiu era o último, o participante mais antigo assume (regra do WhatsApp).
create function public.grupo_sem_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conversation uuid := coalesce(new.conversation_id, old.conversation_id);
begin
  if not exists (select 1 from public.conversations where id = v_conversation) then return null; end if;
  if exists (select 1 from public.conversation_members where conversation_id = v_conversation and left_at is null and admin) then return null; end if;
  update public.conversation_members set admin = true
  where (conversation_id, user_id) = (
    select conversation_id, user_id from public.conversation_members
    where conversation_id = v_conversation and left_at is null order by joined_at, user_id limit 1
  );
  return null;
end $$;
revoke execute on function public.grupo_sem_admin() from public, anon, authenticated;
create trigger conversation_members_admin after update of left_at, admin or delete on public.conversation_members
  for each row execute function public.grupo_sem_admin();

create function public.group_event(p_conversation uuid, p_type text, p_users uuid[] default null, p_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  insert into public.messages (user_id, author_name, author_avatar, conversation_id, event)
  values (v_profile.id, v_profile.name, v_profile.avatar_url, p_conversation, jsonb_strip_nulls(jsonb_build_object(
    'type', p_type, 'name', p_name,
    'users', (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name) from public.profiles p where p.id = any (p_users))
  )));
end $$;
revoke execute on function public.group_event(uuid, text, uuid[], text) from public, anon, authenticated;

-- Quem dá para colocar num grupo: existe, não foi banido e não bloqueou quem está adicionando
-- (quem bloqueou não fica sabendo: simplesmente não entra).
create function public.addable_people(p_users uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
  where p.id = any (p_users) and p.id <> (select auth.uid()) and p.banned_at is null
    and not exists (select 1 from public.user_blocks b
                    where (b.blocker_id = p.id and b.blocked_id = (select auth.uid())) or (b.blocker_id = (select auth.uid()) and b.blocked_id = p.id));
$$;
revoke execute on function public.addable_people(uuid[]) from public, anon, authenticated;

-- Criar grupo: nome, descrição opcional e pelo menos uma pessoa. Quem cria é admin.
create function public.create_group(p_name text, p_members uuid[], p_description text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(p_description), '');
  v_members uuid[];
  v_since bigint;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Entre na sua conta para criar grupos.' using errcode = '28000'; end if;
  if (select banned_at from public.profiles where id = v_uid) is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'Dê um nome de até 100 letras para o grupo.'; end if;
  if coalesce(char_length(v_description), 0) > 512 then raise exception 'A descrição pode ter até 512 letras.'; end if;
  if public.has_banned_term(v_name) or (v_description is not null and public.has_banned_term(v_description)) then
    raise exception 'O nome ou a descrição tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  if (select count(*) from public.conversations where created_by = v_uid and is_group and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Você criou muitos grupos agora há pouco. Tente de novo mais tarde.';
  end if;
  v_members := public.addable_people((select array_agg(distinct x) from unnest(p_members[1:300]) x));
  if cardinality(v_members) = 0 then raise exception 'Escolha pelo menos uma pessoa para o grupo.'; end if;
  if cardinality(v_members) > 255 then raise exception 'Um grupo pode ter até 256 participantes.'; end if;

  insert into public.conversations (is_group, name, description, created_by) values (true, v_name, v_description, v_uid)
  returning id into v_id;
  select coalesce(max(id), 0) into v_since from public.messages;
  insert into public.conversation_members (conversation_id, user_id, admin, added_by, since_id)
  select v_id, u, u = v_uid, v_uid, v_since from unnest(v_members || v_uid) u;
  perform public.group_event(v_id, 'created', v_members, v_name);
  return v_id;
end $$;

-- Adicionar participantes (só admins). Quem já saiu pode voltar; não vê o que foi falado enquanto estava fora.
create function public.add_group_members(p_conversation uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_users uuid[];
  v_since bigint;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem adicionar participantes.' using errcode = '42501'; end if;
  select coalesce(array_agg(u), '{}') into v_users from unnest(public.addable_people(p_users[1:300])) u
  where not exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = u and m.left_at is null);
  if cardinality(v_users) = 0 then raise exception 'Ninguém para adicionar: essas pessoas já estão no grupo ou não podem entrar.'; end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation and left_at is null) + cardinality(v_users) > 256 then
    raise exception 'Um grupo pode ter até 256 participantes.';
  end if;
  select coalesce(max(id), 0) into v_since from public.messages;
  insert into public.conversation_members (conversation_id, user_id, added_by, since_id)
  select p_conversation, u, v_uid, v_since from unnest(v_users) u
  on conflict (conversation_id, user_id) do update
    set left_at = null, admin = false, added_by = excluded.added_by, joined_at = now(), since_id = excluded.since_id;
  perform public.group_event(p_conversation, 'added', v_users);
  return cardinality(v_users);
end $$;

-- Remover alguém (só admins). Para sair do grupo é leave_group.
create function public.remove_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem remover participantes.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Para sair, use "Sair do grupo".'; end if;
  update public.conversation_members set left_at = now(), admin = false
  where conversation_id = p_conversation and user_id = p_user and left_at is null;
  if not found then raise exception 'Essa pessoa não está no grupo.'; end if;
  perform public.group_event(p_conversation, 'removed', array[p_user]);
end $$;

-- Sair do grupo. O último a sair apaga o grupo (com as mensagens).
create function public.leave_group(p_conversation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not exists (select 1 from public.conversations where id = p_conversation and is_group) or not public.is_participant(p_conversation) then
    raise exception 'Você não participa deste grupo.';
  end if;
  perform public.group_event(p_conversation, 'left');
  update public.conversation_members set left_at = now(), admin = false where conversation_id = p_conversation and user_id = auth.uid();
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation and left_at is null) then
    delete from public.conversations where id = p_conversation;
  end if;
end $$;

create function public.set_group_admin(p_conversation uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem mudar os admins.' using errcode = '42501'; end if;
  update public.conversation_members set admin = coalesce(p_admin, false)
  where conversation_id = p_conversation and user_id = p_user and left_at is null;
  if not found then raise exception 'Essa pessoa não está no grupo.'; end if;
end $$;

-- Nome e descrição (só admins). Cada mudança vira um aviso na conversa.
create function public.update_group(p_conversation uuid, p_name text, p_description text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(p_description), '');
  v_group public.conversations;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem mudar os dados do grupo.' using errcode = '42501'; end if;
  if (select banned_at from public.profiles where id = auth.uid()) is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then raise exception 'Dê um nome de até 100 letras para o grupo.'; end if;
  if coalesce(char_length(v_description), 0) > 512 then raise exception 'A descrição pode ter até 512 letras.'; end if;
  if public.has_banned_term(v_name) or (v_description is not null and public.has_banned_term(v_description)) then
    raise exception 'O nome ou a descrição tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  select * into v_group from public.conversations where id = p_conversation;
  update public.conversations set name = v_name, description = v_description where id = p_conversation;
  if v_group.name is distinct from v_name then perform public.group_event(p_conversation, 'renamed', null, v_name); end if;
  if v_group.description is distinct from v_description then perform public.group_event(p_conversation, 'description'); end if;
end $$;

-- Foto do grupo (só admins): imagem já enviada para "<grupo>/<pessoa>/..." no bucket dm. Nulo tira a foto.
-- A primeira foto, posta por quem criou logo depois de criar, não vira aviso (faz parte da criação).
create function public.set_group_photo(p_conversation uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_group public.conversations;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem mudar a foto.' using errcode = '42501'; end if;
  if p_path is not null and (
    p_path not like p_conversation::text || '/' || v_uid::text || '/%'
    or not exists (select 1 from storage.objects o where o.bucket_id = 'dm' and o.name = p_path and o.metadata->>'mimetype' like 'image/%')
  ) then raise exception 'Foto inválida. Tente enviar de novo.'; end if;
  select * into v_group from public.conversations where id = p_conversation;
  update public.conversations set photo_path = p_path where id = p_conversation;
  if not (v_group.photo_path is null and v_group.created_by = v_uid and v_group.created_at > now() - interval '10 minutes') then
    perform public.group_event(p_conversation, 'photo');
  end if;
end $$;

-- Participantes de um grupo, admins primeiro (como na tela de dados do WhatsApp).
create function public.group_members(p_conversation uuid)
returns table (user_id uuid, name text, avatar_url text, admin boolean, joined_at timestamptz)
language sql stable set search_path = '' as $$
  select m.user_id, p.name, p.avatar_url, m.admin, m.joined_at
  from public.conversation_members m join public.profiles p on p.id = m.user_id
  where m.conversation_id = p_conversation and m.left_at is null and public.is_participant(p_conversation)
  order by m.admin desc, p.name;
$$;

-- Enviar: no grupo valem as regras das particulares (bucket dm), sem o bloqueio de 1 para 1,
-- e com menções a quem está no grupo. O limite de velocidade ignora os avisos do grupo.
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

  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height, reply_to, conversation_id, duration_ms, waveform, mentions)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end,
    p_reply_to, p_conversation_id,
    case when v_voice then p_duration_ms end,
    case when v_voice then (select array_agg(least(greatest(coalesce(v, 0), 0), 100)::smallint) from unnest(p_waveform[1:100]) v) end,
    v_mentions
  )
  returning * into v_message;
  return v_message;
end $$;

-- Reagir só vale para mensagens de verdade (não para os avisos) que a pessoa consegue ler.
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
      where id = p_message_id and deleted_at is null and event is null
        and (conversation_id is null or public.can_read_message(conversation_id, id))
    ) then
      raise exception 'Mensagem não encontrada.';
    end if;
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, v_uid, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

-- "Entregue" (✓✓ cinza) também nos grupos de que a pessoa participa.
create or replace function public.mark_delivered(p_conversation_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.conversation_reads (conversation_id, user_id, last_delivered_id)
  select c.id, v_uid, m.max_id
  from public.conversations c
  cross join lateral (select max(id) as max_id from public.messages where conversation_id = c.id and user_id <> v_uid) m
  where (v_uid in (c.user_a, c.user_b) or exists (
      select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = v_uid and cm.left_at is null))
    and (p_conversation_id is null or c.id = p_conversation_id)
    and m.max_id is not null
  on conflict (conversation_id, user_id) do update
    set last_delivered_id = excluded.last_delivered_id, updated_at = now()
    where public.conversation_reads.last_delivered_id < excluded.last_delivered_id;
end $$;

-- A listagem traz o evento dos avisos.
drop function public.chat_messages(bigint, int, uuid);
create function public.chat_messages(p_before bigint default null, p_limit int default 50, p_conversation_id uuid default null)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, conversation_id uuid, duration_ms int, waveform smallint[], mentions uuid[], event jsonb,
  played_by_me boolean, played_by_others boolean, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at, m.conversation_id, m.duration_ms, m.waveform, m.mentions, m.event,
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

-- Lista de conversas com os grupos: nome, foto e descrição, quem mandou a última, menções a você
-- e os tiques (no grupo, azul só quando todo mundo leu, como no WhatsApp).
drop function public.my_conversations();
create function public.my_conversations()
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
       where c.is_group and m.conversation_id = c.id and m.id > c.my_read and m.deleted_at is null and (select auth.uid()) = any (m.mentions)),
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

-- Notificação: no grupo, todo mundo que participa recebe (a send-push decide o texto e quem bloqueou o autor).
-- Dos avisos, só "criou o grupo" e "adicionou" viram notificação, para quem entrou.
create or replace function public.avisar_mensagem_nova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_segredo text;
begin
  if new.conversation_id is null and new.reply_to is null and cardinality(new.mentions) = 0 then return new; end if;
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

revoke execute on function public.can_read_message(uuid, bigint), public.is_group_admin(uuid) from public;
grant execute on function public.can_read_message(uuid, bigint), public.is_group_admin(uuid) to anon, authenticated;
revoke execute on function public.create_group(text, uuid[], text), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.set_group_admin(uuid, uuid, boolean),
  public.update_group(uuid, text, text), public.set_group_photo(uuid, text), public.group_members(uuid),
  public.my_conversations() from public, anon;
grant execute on function public.create_group(text, uuid[], text), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.leave_group(uuid), public.set_group_admin(uuid, uuid, boolean),
  public.update_group(uuid, text, text), public.set_group_photo(uuid, text), public.group_members(uuid),
  public.my_conversations() to authenticated;
grant execute on function public.chat_messages(bigint, int, uuid) to anon, authenticated;
