-- Localização, como no WhatsApp: a atual (um ponto fixo no mapa) e a em tempo real (15 minutos, 1 hora ou 8 horas),
-- que vai se mexendo no mapa enquanto o app de quem compartilha está aberto.
-- Só nas conversas particulares e nos grupos: o grupo geral é aberto até para quem não entrou, e localização ali seria pública.

-- O ponto enviado: { lat, lng, accuracy (metros), live_until (só na em tempo real) }.
-- Parar de compartilhar antes da hora é trazer o live_until para agora.
alter table public.messages
  add column location jsonb check (location is null or (
    jsonb_typeof(location->'lat') = 'number' and jsonb_typeof(location->'lng') = 'number'
    and (location->>'lat')::float8 between -90 and 90 and (location->>'lng')::float8 between -180 and 180
  ));
alter table public.messages drop constraint messages_check;
alter table public.messages add constraint messages_check
  check (deleted_at is not null or body is not null or file_path is not null or event is not null or location is not null);
create index messages_live_location_idx on public.messages (user_id) where location ? 'live_until' and deleted_at is null;

-- Onde cada pessoa está agora em cada localização em tempo real que ela mandou.
create table public.live_locations (
  message_id bigint primary key references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,
  heading real,
  updated_at timestamptz not null default now()
);
create index live_locations_user_idx on public.live_locations (user_id);
alter table public.live_locations enable row level security;
-- Vê quem pode ler a mensagem (as duas pessoas da particular, ou quem estava no grupo quando ela chegou).
create policy live_locations_read on public.live_locations for select to authenticated
  using (public.can_read_message(conversation_id, message_id));
-- anon também precisa do grant: o chat_messages (aberto a visitantes) consulta a tabela; sem política, não vê nada.
grant select on public.live_locations to anon, authenticated;
alter publication supabase_realtime add table public.live_locations;

-- Enviar localização: mesmas regras do send_message (conta, ban, limite, bloqueio, participante).
-- p_live_minutes nulo = localização atual; 15, 60 ou 480 = em tempo real. p_body é o comentário.
create function public.send_location(
  p_conversation_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_live_minutes int default null,
  p_body text default null,
  p_reply_to bigint default null
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_profile public.profiles;
  v_conversation public.conversations;
  v_other uuid;
  v_location jsonb;
  v_message public.messages;
begin
  if v_uid is null then raise exception 'Entre na sua conta para enviar mensagens.' using errcode = '28000'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.banned_at is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if (select count(*) from public.messages where user_id = v_uid and event is null and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Calma! Você está enviando mensagens rápido demais.';
  end if;
  if p_conversation_id is null then
    raise exception 'Localização só pode ser enviada em conversas particulares e grupos.';
  end if;
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
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Localização inválida.';
  end if;
  if p_live_minutes is not null and p_live_minutes not in (15, 60, 480) then
    raise exception 'Escolha 15 minutos, 1 hora ou 8 horas.';
  end if;
  if p_live_minutes is null then v_body := null; end if;
  if v_body is not null and public.has_banned_term(v_body) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to and deleted_at is null and event is null and conversation_id = p_conversation_id
      and public.can_read_message(p_conversation_id, id)
  ) then
    raise exception 'A mensagem que você quer responder foi apagada.';
  end if;

  -- Como no WhatsApp, a mesma conversa tem uma localização em tempo real sua por vez: a nova encerra a anterior.
  if p_live_minutes is not null then
    update public.messages set location = jsonb_set(location, '{live_until}', to_jsonb(now()))
    where user_id = v_uid and conversation_id = p_conversation_id and location ? 'live_until'
      and deleted_at is null and (location->>'live_until')::timestamptz > now();
  end if;

  v_location := jsonb_strip_nulls(jsonb_build_object(
    'lat', round(p_lat::numeric, 6), 'lng', round(p_lng::numeric, 6),
    'accuracy', case when p_accuracy between 0 and 100000 then round(p_accuracy::numeric) end,
    'live_until', case when p_live_minutes is not null then now() + make_interval(mins => p_live_minutes) end
  ));
  insert into public.messages (user_id, author_name, author_avatar, body, reply_to, conversation_id, location)
  values (v_uid, v_profile.name, v_profile.avatar_url, left(v_body, 2000), p_reply_to, p_conversation_id, v_location)
  returning * into v_message;
  if p_live_minutes is not null then
    insert into public.live_locations (message_id, user_id, conversation_id, lat, lng, accuracy)
    values (v_message.id, v_uid, p_conversation_id, p_lat, p_lng, case when p_accuracy between 0 and 100000 then p_accuracy end);
  end if;
  return v_message;
end $$;

-- Posição nova de quem está compartilhando: vale para todas as localizações em tempo real ainda ativas da pessoa.
-- Devolve quantas continuam ativas (zero: o app para de acompanhar o GPS).
create function public.update_live_location(p_lat double precision, p_lng double precision, p_accuracy real default null, p_heading real default null)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_active int;
begin
  if v_uid is null then return 0; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Localização inválida.';
  end if;
  select count(*) into v_active from public.live_locations l join public.messages m on m.id = l.message_id
  where l.user_id = v_uid and m.deleted_at is null and (m.location->>'live_until')::timestamptz > now()
    and public.is_participant(l.conversation_id);
  -- No máximo uma posição a cada 3 segundos por localização.
  update public.live_locations l set lat = p_lat, lng = p_lng,
    accuracy = case when p_accuracy between 0 and 100000 then p_accuracy end,
    heading = case when p_heading between 0 and 360 then p_heading end,
    updated_at = now()
  from public.messages m
  where l.user_id = v_uid and m.id = l.message_id and m.deleted_at is null
    and (m.location->>'live_until')::timestamptz > now() and l.updated_at < now() - interval '3 seconds'
    and public.is_participant(l.conversation_id);
  return v_active;
end $$;

-- Parar de compartilhar: uma localização (p_message_id) ou todas as suas (nulo).
create function public.stop_live_location(p_message_id bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  update public.messages set location = jsonb_set(location, '{live_until}', to_jsonb(now()))
  where user_id = auth.uid() and (p_message_id is null or id = p_message_id)
    and location ? 'live_until' and deleted_at is null and (location->>'live_until')::timestamptz > now();
end $$;

-- Localizações em tempo real suas que ainda estão ativas (o app volta a mandar a posição ao abrir).
create function public.my_live_locations()
returns table (message_id bigint, conversation_id uuid, live_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.conversation_id, (m.location->>'live_until')::timestamptz
  from public.messages m
  where m.user_id = (select auth.uid()) and m.location ? 'live_until' and m.deleted_at is null
    and (m.location->>'live_until')::timestamptz > now() and public.is_participant(m.conversation_id)
  order by m.id;
$$;

-- Apagar a mensagem apaga também o ponto no mapa e para de compartilhar.
create or replace function public.delete_message(p_id bigint) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_paths text[]; v_uid uuid := auth.uid(); v_moderador boolean;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  select p.role = 'moderator' into v_moderador from public.profiles p where p.id = v_uid;
  update public.messages set
    deleted_at = now(), deleted_by = v_uid, body = null, file_path = null, file_name = null,
    file_type = null, file_size = null, thumb_path = null, width = null, height = null, location = null
  where id = p_id and deleted_at is null and (user_id = v_uid or coalesce(v_moderador, false))
  returning array_remove(array[file_path, thumb_path], null) into v_paths;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  delete from public.message_reactions where message_id = p_id;
  delete from public.live_locations where message_id = p_id;
  return coalesce(v_paths, '{}');
end $$;

create or replace function public.ban_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'moderator') then
    raise exception 'Só a organização pode banir.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then raise exception 'Você não pode banir a si mesmo.'; end if;
  update public.profiles set banned_at = now(), banned_by = v_uid where id = p_user_id;
  update public.messages
     set deleted_at = now(), deleted_by = v_uid, body = null,
         file_path = null, thumb_path = null, file_name = null, file_type = null, location = null
   where user_id = p_user_id and deleted_at is null;
  delete from public.live_locations where user_id = p_user_id;
end $$;

-- Comentário da localização em tempo real não se edita (como no WhatsApp).
create or replace function public.edit_message(p_id bigint, p_body text) returns public.messages
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
  if v_message.body is null or v_message.location is not null then raise exception 'Só dá para editar mensagens com texto.'; end if;
  if v_message.created_at < now() - interval '15 minutes' then
    raise exception 'Mensagens só podem ser editadas até 15 minutos depois do envio.';
  end if;
  update public.messages set body = v_body, edited_at = now() where id = p_id returning * into v_message;
  return v_message;
end $$;

-- A listagem traz a localização e, na em tempo real, onde a pessoa está agora.
drop function public.chat_messages(bigint, int, uuid);
create function public.chat_messages(p_before bigint default null, p_limit int default 50, p_conversation_id uuid default null)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, deleted_by uuid,
  reply_to bigint, edited_at timestamptz, conversation_id uuid, duration_ms int, waveform smallint[], mentions uuid[], mention_all boolean, event jsonb,
  location jsonb, live jsonb,
  played_by_me boolean, played_by_others boolean, reply jsonb, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at, m.deleted_by,
         m.reply_to, m.edited_at, m.conversation_id, m.duration_ms, m.waveform, m.mentions, m.mention_all, m.event,
         m.location,
         (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'accuracy', l.accuracy, 'heading', l.heading, 'updated_at', l.updated_at)
          from public.live_locations l where l.message_id = m.id),
         exists (select 1 from public.message_plays p where p.message_id = m.id and p.user_id = (select auth.uid())),
         exists (select 1 from public.message_plays p where p.message_id = m.id and p.user_id <> m.user_id),
         (select jsonb_build_object('id', q.id, 'user_id', q.user_id, 'author_name', q.author_name,
                   'body', left(q.body, 200), 'file_type', q.file_type, 'file_name', q.file_name,
                   'thumb_path', q.thumb_path, 'duration_ms', q.duration_ms, 'location', q.location, 'deleted', q.deleted_at is not null)
          from public.messages q where q.id = m.reply_to),
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where m.conversation_id is not distinct from p_conversation_id
    and (p_before is null or m.id < p_before)
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Lista de conversas: a prévia mostra o alfinete de "Localização" / "Localização em tempo real".
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
              'file_name', m.file_name, 'created_at', m.created_at, 'deleted', m.deleted_at is not null, 'duration_ms', m.duration_ms, 'event', m.event,
              'location', m.location)
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

revoke execute on function public.send_location(uuid, double precision, double precision, real, int, text, bigint),
  public.update_live_location(double precision, double precision, real, real), public.stop_live_location(bigint),
  public.my_live_locations() from public, anon;
grant execute on function public.send_location(uuid, double precision, double precision, real, int, text, bigint),
  public.update_live_location(double precision, double precision, real, real), public.stop_live_location(bigint),
  public.my_live_locations() to authenticated;
grant execute on function public.chat_messages(bigint, int, uuid) to anon, authenticated;
