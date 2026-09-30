-- Tiques do WhatsApp nas conversas particulares: 🕓 enviando, ✓ enviada, ✓✓ entregue, ✓✓ azul lida.
-- "Entregue" = a mensagem chegou ao app da outra pessoa (aberto em qualquer tela), mesmo sem abrir a conversa.
alter table public.conversation_reads add column last_delivered_id bigint not null default 0;

-- Marca como entregue tudo o que a outra pessoa mandou até agora (numa conversa ou em todas as minhas).
create function public.mark_delivered(p_conversation_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  insert into public.conversation_reads (conversation_id, user_id, last_delivered_id)
  select c.id, v_uid, m.max_id
  from public.conversations c
  cross join lateral (select max(id) as max_id from public.messages where conversation_id = c.id and user_id <> v_uid) m
  where v_uid in (c.user_a, c.user_b)
    and (p_conversation_id is null or c.id = p_conversation_id)
    and m.max_id is not null
  on conflict (conversation_id, user_id) do update
    set last_delivered_id = excluded.last_delivered_id, updated_at = now()
    where public.conversation_reads.last_delivered_id < excluded.last_delivered_id;
end $$;

-- Ler também é ter recebido.
create or replace function public.mark_conversation_read(p_conversation_id uuid, p_last_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_participant(p_conversation_id) then raise exception 'Conversa não encontrada.'; end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_id, last_delivered_id)
  values (p_conversation_id, auth.uid(), greatest(p_last_id, 0), greatest(p_last_id, 0))
  on conflict (conversation_id, user_id) do update
    set last_read_id = greatest(public.conversation_reads.last_read_id, excluded.last_read_id),
        last_delivered_id = greatest(public.conversation_reads.last_delivered_id, excluded.last_read_id),
        updated_at = now();
end $$;

-- A lista de conversas passa a trazer também até onde a outra pessoa recebeu.
drop function public.my_conversations();
create function public.my_conversations()
returns table (id uuid, other_id uuid, other_name text, other_avatar text, last jsonb, unread int, other_read_id bigint, other_delivered_id bigint)
language sql stable set search_path = '' as $$
  select c.id, o.id, o.name, o.avatar_url,
    (select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'body', left(m.body, 200), 'file_type', m.file_type,
              'file_name', m.file_name, 'created_at', m.created_at, 'deleted', m.deleted_at is not null)
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

revoke execute on function public.mark_delivered(uuid), public.my_conversations() from public, anon;
grant execute on function public.mark_delivered(uuid), public.my_conversations() to authenticated;
