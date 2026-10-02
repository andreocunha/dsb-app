-- "Dados da mensagem" do WhatsApp: quem recebeu e quem leu cada mensagem sua, e a que horas.
-- conversation_reads só guarda até onde cada pessoa chegou; o horário de cada avanço fica neste histórico.
-- Como os ids crescem com o tempo, a hora em que alguém leu a mensagem X é a do primeiro avanço que passou de X.

create table public.conversation_read_log (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('read', 'delivered')),
  up_to_id bigint not null,
  at timestamptz not null default now(),
  primary key (conversation_id, user_id, kind, up_to_id)
);
-- Só se lê pelo message_info (security definer): sem política, ninguém acessa direto.
alter table public.conversation_read_log enable row level security;
revoke all on public.conversation_read_log from public, anon, authenticated;

create function public.log_conversation_read() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_read_id > coalesce(old.last_read_id, 0) then
    insert into public.conversation_read_log (conversation_id, user_id, kind, up_to_id)
    values (new.conversation_id, new.user_id, 'read', new.last_read_id) on conflict do nothing;
  end if;
  if new.last_delivered_id > coalesce(old.last_delivered_id, 0) then
    insert into public.conversation_read_log (conversation_id, user_id, kind, up_to_id)
    values (new.conversation_id, new.user_id, 'delivered', new.last_delivered_id) on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.log_conversation_read() from public, anon, authenticated;
create trigger conversation_reads_log after insert or update of last_read_id, last_delivered_id on public.conversation_reads
  for each row execute function public.log_conversation_read();

-- Quem recebeu e leu uma mensagem que você mandou numa conversa particular ou num grupo.
-- read/delivered dizem se já aconteceu; read_at/delivered_at ficam nulos para o que foi lido antes deste histórico existir.
create function public.message_info(p_message_id bigint)
returns table (user_id uuid, name text, avatar_url text, read boolean, read_at timestamptz, delivered boolean, delivered_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_message public.messages;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.conversation_id is null or v_message.user_id is distinct from auth.uid()
     or not public.is_participant(v_message.conversation_id) then
    raise exception 'Mensagem não encontrada.';
  end if;

  return query
  with people as (
    -- Particular: a outra pessoa. Grupo: quem já estava quando a mensagem chegou (e quem saiu depois de recebê-la).
    select case when c.user_a = v_message.user_id then c.user_b else c.user_a end as id
    from public.conversations c where c.id = v_message.conversation_id and not c.is_group
    union
    select cm.user_id from public.conversation_members cm
    where cm.conversation_id = v_message.conversation_id and cm.user_id <> v_message.user_id and cm.since_id < v_message.id
      and (cm.left_at is null or exists (select 1 from public.conversation_reads r
            where r.conversation_id = cm.conversation_id and r.user_id = cm.user_id
              and greatest(r.last_delivered_id, r.last_read_id) >= v_message.id))
  )
  select p.id, pr.name, pr.avatar_url,
    coalesce(r.last_read_id, 0) >= v_message.id, lido.at,
    greatest(coalesce(r.last_delivered_id, 0), coalesce(r.last_read_id, 0)) >= v_message.id,
    -- Ler também é receber: vale o que veio primeiro.
    least(entregue.at, lido.at)
  from people p
  join public.profiles pr on pr.id = p.id
  left join public.conversation_reads r on r.conversation_id = v_message.conversation_id and r.user_id = p.id
  left join lateral (select l.at from public.conversation_read_log l
    where l.conversation_id = v_message.conversation_id and l.user_id = p.id and l.kind = 'read' and l.up_to_id >= v_message.id
    order by l.up_to_id limit 1) lido on true
  left join lateral (select l.at from public.conversation_read_log l
    where l.conversation_id = v_message.conversation_id and l.user_id = p.id and l.kind = 'delivered' and l.up_to_id >= v_message.id
    order by l.up_to_id limit 1) entregue on true
  order by pr.name;
end $$;
revoke execute on function public.message_info(bigint) from public, anon;
grant execute on function public.message_info(bigint) to authenticated;
