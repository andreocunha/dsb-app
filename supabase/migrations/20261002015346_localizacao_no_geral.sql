-- Localização também no grupo geral (Torcida Solar), e o nome/endereço do ponto escolhido no mapa.
-- O geral é aberto a quem não entrou: lá a localização (e a em tempo real) fica visível para qualquer pessoa,
-- igual às outras mensagens dele. O app avisa isso antes de enviar.

-- Em tempo real no geral: conversation_id nulo.
alter table public.live_locations alter column conversation_id drop not null;
drop policy live_locations_read on public.live_locations;
create policy live_locations_read on public.live_locations for select to anon, authenticated
  using (conversation_id is null or public.can_read_message(conversation_id, message_id));

-- Enviar ganha o nome e o endereço do lugar marcado no mapa (vêm do app; só texto curto).
drop function public.send_location(uuid, double precision, double precision, real, int, text, bigint);
create function public.send_location(
  p_conversation_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy real default null,
  p_live_minutes int default null,
  p_body text default null,
  p_reply_to bigint default null,
  p_name text default null,
  p_address text default null
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_name text := left(nullif(btrim(p_name), ''), 120);
  v_address text := left(nullif(btrim(p_address), ''), 200);
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
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Localização inválida.';
  end if;
  if p_live_minutes is not null and p_live_minutes not in (15, 60, 480) then
    raise exception 'Escolha 15 minutos, 1 hora ou 8 horas.';
  end if;
  -- Comentário só na em tempo real; nome e endereço só no ponto fixo.
  if p_live_minutes is null then v_body := null; else v_name := null; v_address := null; end if;
  if public.has_banned_term(concat_ws(' ', v_body, v_name, v_address)) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to and deleted_at is null and event is null and conversation_id is not distinct from p_conversation_id
      and (p_conversation_id is null or public.can_read_message(p_conversation_id, id))
  ) then
    raise exception 'A mensagem que você quer responder foi apagada.';
  end if;

  -- Como no WhatsApp, a mesma conversa tem uma localização em tempo real sua por vez: a nova encerra a anterior.
  if p_live_minutes is not null then
    update public.messages set location = jsonb_set(location, '{live_until}', to_jsonb(now()))
    where user_id = v_uid and conversation_id is not distinct from p_conversation_id and location ? 'live_until'
      and deleted_at is null and (location->>'live_until')::timestamptz > now();
  end if;

  v_location := jsonb_strip_nulls(jsonb_build_object(
    'lat', round(p_lat::numeric, 6), 'lng', round(p_lng::numeric, 6),
    'accuracy', case when p_accuracy between 0 and 100000 then round(p_accuracy::numeric) end,
    'live_until', case when p_live_minutes is not null then now() + make_interval(mins => p_live_minutes) end,
    'name', v_name, 'address', v_address
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

-- No geral não há "participar": vale para todo mundo com conta.
create or replace function public.update_live_location(p_lat double precision, p_lng double precision, p_accuracy real default null, p_heading real default null)
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
    and (l.conversation_id is null or public.is_participant(l.conversation_id));
  -- No máximo uma posição a cada 3 segundos por localização.
  update public.live_locations l set lat = p_lat, lng = p_lng,
    accuracy = case when p_accuracy between 0 and 100000 then p_accuracy end,
    heading = case when p_heading between 0 and 360 then p_heading end,
    updated_at = now()
  from public.messages m
  where l.user_id = v_uid and m.id = l.message_id and m.deleted_at is null
    and (m.location->>'live_until')::timestamptz > now() and l.updated_at < now() - interval '3 seconds'
    and (l.conversation_id is null or public.is_participant(l.conversation_id));
  return v_active;
end $$;

create or replace function public.my_live_locations()
returns table (message_id bigint, conversation_id uuid, live_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.conversation_id, (m.location->>'live_until')::timestamptz
  from public.messages m
  where m.user_id = (select auth.uid()) and m.location ? 'live_until' and m.deleted_at is null
    and (m.location->>'live_until')::timestamptz > now()
    and (m.conversation_id is null or public.is_participant(m.conversation_id))
  order by m.id;
$$;

revoke execute on function public.send_location(uuid, double precision, double precision, real, int, text, bigint, text, text) from public, anon;
grant execute on function public.send_location(uuid, double precision, double precision, real, int, text, bigint, text, text) to authenticated;
