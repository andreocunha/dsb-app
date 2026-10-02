-- O grupo geral (Torcida Solar) igual a um grupo do WhatsApp: ✓✓ cinza quando todo mundo recebeu,
-- ✓✓ azul quando todo mundo leu, e "Dados da mensagem" com quem recebeu e quem leu, e a que horas.
-- Até aqui o último lido do geral ficava só no aparelho; agora fica também no banco.

-- Até onde cada pessoa recebeu e leu o geral. since_id: a última mensagem que já existia quando a pessoa entrou
-- (como no WhatsApp, quem entrou depois não conta para as mensagens de antes).
create table public.general_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  since_id bigint not null default 0,
  last_read_id bigint not null default 0,
  last_delivered_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.general_reads enable row level security;
-- Quem mandou vê quem leu (nos dados da mensagem); o Realtime precisa da leitura para atualizar os tiques.
create policy general_reads_read on public.general_reads for select to authenticated using (true);
grant select on public.general_reads to authenticated;
alter publication supabase_realtime add table public.general_reads;

insert into public.general_reads (user_id, since_id)
select p.id, coalesce((select max(m.id) from public.messages m where m.conversation_id is null and m.created_at <= p.created_at), 0)
from public.profiles p
on conflict do nothing;

create function public.general_reads_novo_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.general_reads (user_id, since_id)
  values (new.id, coalesce((select max(id) from public.messages where conversation_id is null), 0))
  on conflict do nothing;
  return null;
end $$;
revoke execute on function public.general_reads_novo_perfil() from public, anon, authenticated;
create trigger profiles_general_reads after insert on public.profiles
  for each row execute function public.general_reads_novo_perfil();

-- Horário de cada avanço, como o conversation_read_log das particulares e dos grupos.
create table public.general_read_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('read', 'delivered')),
  up_to_id bigint not null,
  at timestamptz not null default now(),
  primary key (user_id, kind, up_to_id)
);
alter table public.general_read_log enable row level security;
revoke all on public.general_read_log from public, anon, authenticated;

create function public.log_general_read() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.last_read_id > coalesce(old.last_read_id, 0) then
    insert into public.general_read_log (user_id, kind, up_to_id) values (new.user_id, 'read', new.last_read_id) on conflict do nothing;
  end if;
  if new.last_delivered_id > coalesce(old.last_delivered_id, 0) then
    insert into public.general_read_log (user_id, kind, up_to_id) values (new.user_id, 'delivered', new.last_delivered_id) on conflict do nothing;
  end if;
  return null;
end $$;
revoke execute on function public.log_general_read() from public, anon, authenticated;
create trigger general_reads_log after insert or update of last_read_id, last_delivered_id on public.general_reads
  for each row execute function public.log_general_read();

-- Leu o geral até p_last_id (ler também é receber).
create function public.mark_general_read(p_last_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_last bigint;
begin
  if auth.uid() is null then return; end if;
  v_last := least(greatest(p_last_id, 0), coalesce((select max(id) from public.messages where conversation_id is null), 0));
  insert into public.general_reads (user_id, last_read_id, last_delivered_id) values (auth.uid(), v_last, v_last)
  on conflict (user_id) do update
    set last_read_id = greatest(public.general_reads.last_read_id, excluded.last_read_id),
        last_delivered_id = greatest(public.general_reads.last_delivered_id, excluded.last_read_id),
        updated_at = now()
    where public.general_reads.last_read_id < excluded.last_read_id;
end $$;

-- Recebeu tudo o que os outros mandaram no geral até agora (app aberto em qualquer tela).
create function public.mark_general_delivered() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_max bigint;
begin
  if v_uid is null then return; end if;
  select max(id) into v_max from public.messages where conversation_id is null and user_id <> v_uid;
  if v_max is null then return; end if;
  insert into public.general_reads (user_id, last_delivered_id) values (v_uid, v_max)
  on conflict (user_id) do update set last_delivered_id = excluded.last_delivered_id, updated_at = now()
    where public.general_reads.last_delivered_id < excluded.last_delivered_id;
end $$;

-- Abrir o app marca como entregue também o geral.
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
  if p_conversation_id is null then perform public.mark_general_delivered(); end if;
end $$;

-- Tiques das suas mensagens no geral: o menor entre todos os participantes (azul só quando todo mundo leu).
-- Quem foi banido não conta; quem entrou depois de uma mensagem conta como se já a tivesse lido.
create function public.general_receipts() returns table (read bigint, delivered bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(min(greatest(coalesce(r.last_read_id, 0), coalesce(r.since_id, 0))), 0),
         coalesce(min(greatest(coalesce(r.last_delivered_id, 0), coalesce(r.last_read_id, 0), coalesce(r.since_id, 0))), 0)
  from public.profiles p
  left join public.general_reads r on r.user_id = p.id
  where p.banned_at is null and p.id <> (select auth.uid());
$$;

-- Dados da mensagem também no geral: participantes são todos do app que já estavam lá quando ela chegou.
create or replace function public.message_info(p_message_id bigint)
returns table (user_id uuid, name text, avatar_url text, read boolean, read_at timestamptz, delivered boolean, delivered_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_message public.messages;
begin
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.user_id is distinct from auth.uid()
     or (v_message.conversation_id is not null and not public.is_participant(v_message.conversation_id)) then
    raise exception 'Mensagem não encontrada.';
  end if;

  if v_message.conversation_id is null then
    return query
    select p.id, p.name, p.avatar_url,
      coalesce(r.last_read_id, 0) >= v_message.id, lido.at,
      greatest(coalesce(r.last_delivered_id, 0), coalesce(r.last_read_id, 0)) >= v_message.id,
      least(entregue.at, lido.at)
    from public.profiles p
    left join public.general_reads r on r.user_id = p.id
    left join lateral (select l.at from public.general_read_log l
      where l.user_id = p.id and l.kind = 'read' and l.up_to_id >= v_message.id order by l.up_to_id limit 1) lido on true
    left join lateral (select l.at from public.general_read_log l
      where l.user_id = p.id and l.kind = 'delivered' and l.up_to_id >= v_message.id order by l.up_to_id limit 1) entregue on true
    where p.banned_at is null and p.id <> v_message.user_id and coalesce(r.since_id, 0) < v_message.id
    order by p.name;
    return;
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

revoke execute on function public.mark_general_read(bigint), public.mark_general_delivered(), public.general_receipts() from public, anon;
grant execute on function public.mark_general_read(bigint), public.mark_general_delivered(), public.general_receipts() to authenticated;
