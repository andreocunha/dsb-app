-- =====================================================================
-- Chat: apagar vira "mensagem apagada" (a linha fica, o conteúdo sai)
-- =====================================================================
alter table public.messages add column deleted_at timestamptz;
alter table public.messages drop constraint messages_check;
alter table public.messages add constraint messages_check
  check (deleted_at is not null or body is not null or file_path is not null);

create or replace function public.delete_message(p_id bigint) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_paths text[];
begin
  update public.messages set
    deleted_at = now(), body = null, file_path = null, file_name = null,
    file_type = null, file_size = null, thumb_path = null, width = null, height = null
  where id = p_id and user_id = auth.uid() and deleted_at is null
  returning array_remove(array[file_path, thumb_path], null) into v_paths;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  delete from public.message_reactions where message_id = p_id;
  return coalesce(v_paths, '{}');
end $$;

drop function public.chat_messages(bigint, int);
create function public.chat_messages(p_before bigint default null, p_limit int default 50)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, deleted_at timestamptz, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at, m.deleted_at,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where p_before is null or m.id < p_before
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Reagir a uma mensagem apagada não faz sentido.
create or replace function public.react_to_message(p_message_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta para reagir.' using errcode = '28000'; end if;
  if p_emoji is null then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_uid;
  else
    if not exists (select 1 from public.messages where id = p_message_id and deleted_at is null) then
      raise exception 'Mensagem não encontrada.';
    end if;
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, v_uid, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

-- Quantas mensagens novas de outras pessoas chegaram depois da última lida.
create function public.unread_count(p_after bigint default 0) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.messages
  where id > coalesce(p_after, 0) and user_id is distinct from auth.uid();
$$;

-- =====================================================================
-- Fantasy v2: 3 barcos por prova, um deles vale em dobro
-- =====================================================================
delete from public.fantasy_lineups; -- escalações antigas eram por tier (A/B/B/C)
alter table public.fantasy_lineups drop constraint fantasy_lineups_team_ids_check;
alter table public.fantasy_lineups add constraint fantasy_lineups_team_ids_check
  check (cardinality(team_ids) between 1 and 3 and array_position(team_ids, null) is null);
alter table public.fantasy_lineups add column double_team_id text references public.teams(id) on delete set null;

drop function public.save_lineup(text, text[]);
create function public.save_lineup(p_race_id text, p_team_ids text[], p_double text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_ids text[] := coalesce(p_team_ids, '{}');
begin
  if v_uid is null then raise exception 'Entre na sua conta para escalar.' using errcode = '28000'; end if;
  select starts_at into v_start from public.races where id = p_race_id;
  if v_start is null then raise exception 'Prova não encontrada.'; end if;
  if v_start <= now() then raise exception 'A escalação desta prova já fechou.'; end if;

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

create or replace function public.copy_lineup_forward(p_race_id text) returns void
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
  where r.number > (select number from public.races where id = p_race_id) and r.starts_at > now()
  on conflict (user_id, race_id) do update
    set team_ids = excluded.team_ids, double_team_id = excluded.double_team_id, updated_at = now();
end $$;

-- Ranking com o bônus do 2x.
create or replace function public.fantasy_ranking(p_limit int default 100)
returns table (user_id uuid, name text, avatar_url text, points int, "position" bigint)
language sql stable security definer set search_path = '' as $$
  with picks as (
    select l.user_id, l.race_id, t.team_id, (t.team_id = l.double_team_id) as doubled
    from public.fantasy_lineups l
    cross join lateral unnest(l.team_ids) as t(team_id)
  ), scores as (
    select p.user_id, coalesce(sum(r.points * case when p.doubled then 2 else 1 end), 0)::int as points
    from picks p
    left join public.race_results r on r.race_id = p.race_id and r.team_id = p.team_id
    group by p.user_id
  ), ranked as (
    select s.user_id, pr.name, pr.avatar_url, s.points, rank() over (order by s.points desc) as "position"
    from scores s join public.profiles pr on pr.id = s.user_id
  )
  select * from ranked
  where "position" <= least(greatest(p_limit, 1), 500) or ranked.user_id = auth.uid()
  order by "position", name;
$$;

grant execute on function public.chat_messages(bigint, int), public.unread_count(bigint) to anon, authenticated;
grant execute on function public.save_lineup(text, text[], text) to authenticated;
