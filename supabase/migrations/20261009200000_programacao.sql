-- Programação do evento: provas e os outros itens (abertura, seminários, premiação),
-- com atraso e mudança de horário registrados e o fim de cada prova.
--
-- races.starts_at é sempre o horário em vigor: atrasar ou remarcar troca ele (e com ele o
-- fechamento do fantasy e o lembrete de push) e deixa uma linha em schedule_changes.

-- ---------------------------------------------------------------------
-- Tempo de prova (Instrução Técnica) e fim marcado pela organização
-- ---------------------------------------------------------------------
alter table public.races
  add column closing_minutes smallint check (closing_minutes >= 0),
  add column finished_at timestamptz;
comment on column public.races.closing_minutes is 'Tempo depois do fim da prova para fechar a última volta (limite de tempo da Instrução Técnica).';
comment on column public.races.finished_at is 'Fim marcado pela organização. Vazio = largada + duração + fechamento (ou o fim do dia, sem duração).';

update public.races set duration_minutes = 60,  closing_minutes = 20 where id = 'raia-rapida';
update public.races set duration_minutes = 120, closing_minutes = 30 where id = 'raia-manobra';
update public.races set duration_minutes = 240, closing_minutes = 30 where id = 'raia-longa';
update public.races set duration_minutes = 180, closing_minutes = 30 where id = 'revezamento';

-- ---------------------------------------------------------------------
-- Itens da programação que não são provas
-- ---------------------------------------------------------------------
create table public.event_items (
  id text primary key,
  title text not null check (char_length(title) between 1 and 60),
  starts_at timestamptz not null,
  duration_minutes smallint check (duration_minutes > 0)
);
comment on table public.event_items is 'Abertura, seminários, premiação: o que aparece na programação além das provas.';
insert into public.event_items (id, title, starts_at) values
  ('abertura',     'Abertura oficial',          '2026-10-13 14:00-03'),
  ('seminario-1',  'Seminário DSB',             '2026-10-15 16:00-03'),
  ('seminario-2',  'Seminário DSB',             '2026-10-16 16:00-03'),
  ('premiacao',    'Premiação e encerramento',  '2026-10-18 10:00-03');
alter table public.event_items enable row level security;
create policy event_items_read on public.event_items for select to anon, authenticated using (true);
grant select on public.event_items to anon, authenticated;

-- ---------------------------------------------------------------------
-- Histórico de horários
-- ---------------------------------------------------------------------
create table public.schedule_changes (
  id bigint generated always as identity primary key,
  race_id text references public.races(id) on delete cascade,
  event_item_id text references public.event_items(id) on delete cascade,
  previous_at timestamptz not null,
  new_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 120),
  changed_at timestamptz not null default now(),
  check (num_nonnulls(race_id, event_item_id) = 1)
);
create index schedule_changes_race_idx on public.schedule_changes (race_id) where race_id is not null;
create index schedule_changes_item_idx on public.schedule_changes (event_item_id) where event_item_id is not null;
alter table public.schedule_changes enable row level security;
create policy schedule_changes_read on public.schedule_changes for select to anon, authenticated using (true);
grant select on public.schedule_changes to anon, authenticated;

-- Mudar o horário aparece na hora para quem está com o app aberto.
alter publication supabase_realtime add table public.races, public.event_items, public.schedule_changes;

-- ---------------------------------------------------------------------
-- Painel da organização
-- ---------------------------------------------------------------------
-- p_kind: 'race' ou 'event'. Registra o horário anterior; não mexe em prova que já largou.
create function public.admin_reschedule(p_kind text, p_id text, p_at timestamptz, p_reason text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare v_previous timestamptz; v_reason text := trim(coalesce(p_reason, ''));
begin
  perform public.require_admin();
  if p_at is null then raise exception 'Informe o novo horário.'; end if;
  if char_length(v_reason) > 120 then raise exception 'O motivo pode ter até 120 caracteres.'; end if;
  if p_kind = 'race' then
    select starts_at into v_previous from public.races where id = p_id and started_at is null for update;
    if not found then raise exception 'Prova não encontrada ou já largou.'; end if;
    if v_previous = p_at then return; end if;
    update public.races set starts_at = p_at where id = p_id;
    insert into public.schedule_changes (race_id, previous_at, new_at, reason) values (p_id, v_previous, p_at, v_reason);
  elsif p_kind = 'event' then
    select starts_at into v_previous from public.event_items where id = p_id for update;
    if not found then raise exception 'Item da programação não encontrado.'; end if;
    if v_previous = p_at then return; end if;
    update public.event_items set starts_at = p_at where id = p_id;
    insert into public.schedule_changes (event_item_id, previous_at, new_at, reason) values (p_id, v_previous, p_at, v_reason);
  else
    raise exception 'Tipo inválido.';
  end if;
end $$;

-- Fim da prova marcado à mão (Match Race, Slalom e Sprint não têm duração). Nulo reabre.
create function public.admin_set_race_finish(p_race_id text, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.races set finished_at = p_at where id = p_race_id;
  if not found then raise exception 'Prova não encontrada.'; end if;
end $$;

revoke execute on function public.admin_reschedule(text, text, timestamptz, text), public.admin_set_race_finish(text, timestamptz) from public, anon;
grant execute on function public.admin_reschedule(text, text, timestamptz, text), public.admin_set_race_finish(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Fantasy: a escalação fecha no horário em vigor ou na largada real, o que vier antes
-- ---------------------------------------------------------------------
create or replace function public.save_lineup(p_race_id text, p_team_ids text[], p_double text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_started timestamptz;
  v_ids text[] := coalesce(p_team_ids, '{}');
begin
  if v_uid is null then raise exception 'Entre na sua conta para escalar.' using errcode = '28000'; end if;
  select starts_at, started_at into v_start, v_started from public.races where id = p_race_id;
  if v_start is null then raise exception 'Prova não encontrada.'; end if;
  if v_start <= now() or v_started is not null then raise exception 'A escalação desta prova já fechou.'; end if;

  if cardinality(v_ids) = 0 then
    delete from public.fantasy_lineups where user_id = v_uid and race_id = p_race_id;
    return;
  end if;
  if cardinality(v_ids) > 3 then raise exception 'Escolha no máximo 3 barcos.'; end if;
  if array_position(v_ids, null) is not null then raise exception 'Escalação inválida.'; end if;
  if (select count(distinct id) from unnest(v_ids) as id) <> cardinality(v_ids) then
    raise exception 'Não repita o mesmo barco.';
  end if;
  if exists (select 1 from unnest(v_ids) as id where not exists (select 1 from public.teams t where t.id = id and t.active)) then
    raise exception 'Barco inválido.';
  end if;
  if p_double is not null and not (p_double = any(v_ids)) then
    raise exception 'O 2x precisa ser um dos barcos escolhidos.';
  end if;

  insert into public.fantasy_lineups (user_id, race_id, team_ids, double_team_id)
  values (v_uid, p_race_id, v_ids, p_double)
  on conflict (user_id, race_id) do update
    set team_ids = excluded.team_ids, double_team_id = excluded.double_team_id, updated_at = now();
end $$;

create or replace function public.copy_lineup_forward(p_race_id text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_lineup public.fantasy_lineups;
begin
  if v_uid is null then raise exception 'Entre na sua conta para escalar.' using errcode = '28000'; end if;
  select * into v_lineup from public.fantasy_lineups where user_id = v_uid and race_id = p_race_id;
  if v_lineup is null then raise exception 'Monte esta escalação primeiro.'; end if;
  insert into public.fantasy_lineups (user_id, race_id, team_ids, double_team_id)
  select v_uid, r.id, v_lineup.team_ids, v_lineup.double_team_id from public.races r
  where r.number > (select number from public.races where id = p_race_id) and r.starts_at > now() and r.started_at is null
  on conflict (user_id, race_id) do update
    set team_ids = excluded.team_ids, double_team_id = excluded.double_team_id, updated_at = now();
end $$;
