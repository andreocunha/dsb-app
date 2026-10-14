-- O "visto" do sino da home passa a valer para a conta: abrir as notificações num aparelho apaga
-- o número do sino (e tira os recados da bandeja) nos outros, como já acontece com as não lidas do chat.
-- Quem usa sem conta continua com o visto só no aparelho.

create table public.notification_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.notification_reads enable row level security;
-- Cada pessoa lê só a própria linha; é por ela que o Realtime avisa os outros aparelhos da conta.
create policy notification_reads_own on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notification_reads from anon, authenticated;
grant select on public.notification_reads to authenticated;
alter publication supabase_realtime add table public.notification_reads;

-- Viu o sino até a notificação p_last_id: nunca volta atrás nem passa da última que existe.
create function public.mark_notifications_seen(p_last_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_last bigint;
begin
  if auth.uid() is null then return; end if;
  v_last := least(greatest(p_last_id, 0), coalesce((select max(id) from public.notifications), 0));
  if v_last = 0 then return; end if;
  insert into public.notification_reads (user_id, last_seen_id) values (auth.uid(), v_last)
  on conflict (user_id) do update
    set last_seen_id = excluded.last_seen_id, updated_at = now()
    where public.notification_reads.last_seen_id < excluded.last_seen_id;
end $$;
revoke execute on function public.mark_notifications_seen(bigint) from public, anon;
grant execute on function public.mark_notifications_seen(bigint) to authenticated;
