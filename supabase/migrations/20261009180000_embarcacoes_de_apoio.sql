-- Jet ski de resgate e barco de apoio no rastreio: cadastrados em teams (para vincular trackers,
-- mapa ao vivo e SOS), mas fora da competição (classificação e escalação).
alter table public.teams drop constraint if exists teams_boat_hull_check;
alter table public.teams add constraint teams_boat_hull_check check (boat_hull in ('cat', 'mono', 'jetski', 'support'));

create or replace view public.team_standings with (security_invoker = true) as
 select t.id,
    t.name,
    t.university,
    t.initials,
    t.color,
    t.logo,
    coalesce(s.race_points, 0) + t.docs_delivered * 20 + case when t.article_delivered then 20 else 0 end + coalesce(p.penalty_points, 0) as points,
    coalesce(s.race_points, 0) as race_points,
    t.docs_delivered,
    t.article_delivered,
    coalesce(p.penalty_points, 0) as penalty_points,
    (select rs."position" from public.race_scores rs
      where rs.team_id = t.id and rs.race_id = (select races.id from public.races order by races.duration_minutes desc nulls last, races.number limit 1)) as tiebreak_position
   from public.teams t
     left join (select race_scores.team_id, sum(race_scores.points)::integer as race_points from public.race_scores group by race_scores.team_id) s on s.team_id = t.id
     left join (select penalties.team_id, sum(penalties.points)::integer as penalty_points from public.penalties group by penalties.team_id) p on p.team_id = t.id
  where t.active and t.boat_hull in ('cat', 'mono');
