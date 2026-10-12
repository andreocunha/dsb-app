-- Fantasy: ninguém empata no ranking. Com os mesmos pontos, fica na frente quem montou o fantasy primeiro.

-- Quando a pessoa escalou pela primeira vez. Fica no perfil, e não na escalação, porque a escalação
-- some quando fica vazia e tem a data trocada a cada ajuste: quem mexesse nos barcos perderia o lugar.
alter table public.profiles add column fantasy_since timestamptz;

-- Quem já joga: essa data nunca foi guardada. O registro mais antigo que existe é a última alteração
-- da escalação menos mexida de cada pessoa.
update public.profiles p set fantasy_since = l.first_at
from (select user_id, min(updated_at) as first_at from public.fantasy_lineups group by user_id) l
where l.user_id = p.id;

-- Daqui para a frente: marcada na primeira escalação, por qualquer caminho que a crie, e nunca mais trocada.
create function public.mark_fantasy_since() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set fantasy_since = now() where id = new.user_id and fantasy_since is null;
  return new;
end $$;
revoke execute on function public.mark_fantasy_since() from public, anon, authenticated;

create trigger fantasy_lineups_mark_since after insert on public.fantasy_lineups
for each row execute function public.mark_fantasy_since();

-- Mesmo nome e colunas de antes. A colocação passa a ser única: pontos, depois quem montou primeiro
-- (o id só decide entre duas pessoas sem data ou com a mesma data, para a ordem nunca variar).
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
    left join public.race_scores r on r.race_id = p.race_id and r.team_id = p.team_id
    group by p.user_id
  ), ranked as (
    select s.user_id, pr.name, pr.avatar_url, s.points,
      row_number() over (order by s.points desc, pr.fantasy_since asc nulls last, s.user_id) as "position"
    from scores s join public.profiles pr on pr.id = s.user_id
  )
  select * from ranked
  where "position" <= least(greatest(p_limit, 1), 500) or ranked.user_id = auth.uid()
  order by "position";
$$;
