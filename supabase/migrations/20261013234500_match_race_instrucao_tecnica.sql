-- Match Race pela Instrução Técnica de 2026 (12 barcos):
--   Etapa 1 (r16, A1 a A6): os 6 perdedores ficam do 7º ao 12º, pelo tempo.
--   Etapa 2 (qf, B1 a B3): o perdedor de melhor tempo volta pela repescagem (B4); os outros dois ficam em 5º e 6º.
--   Etapa 3 (sf, C1 e C2), disputa de 3º (third) e final.
-- Muda só a colocação na chave; voltas, DNF/DNS e pontos seguem como estavam.
create or replace view public.race_scores with (security_invoker = true) as
with laps as (
  select race_id, team_id, count(*)::int as laps, max(completed_at) as last_lap_at
  from public.race_laps group by race_id, team_id
), decided as (
  select d.*,
    case
      when d.team_a is null or d.team_b is null then coalesce(d.team_a, d.team_b)
      when d.time_a is not null and (d.time_b is null or d.time_a < d.time_b) then d.team_a
      when d.time_b is not null and (d.time_a is null or d.time_b < d.time_a) then d.team_b
    end as winner
  from public.match_duels d
), losers as (
  select l.*,
    -- Perdeu, mas já está num duelo de fase posterior (repescagem, disputa de 3º): vale onde parar depois.
    exists (select 1 from public.match_duels n
            where n.race_id = l.race_id and l.team_id in (n.team_a, n.team_b)
              and array_position(array['r32', 'r16', 'qf', 'sf', 'third', 'final'], n.stage)
                > array_position(array['r32', 'r16', 'qf', 'sf', 'third', 'final'], l.stage)) as back_in
  from (
    select race_id, stage, case when winner = team_a then team_b else team_a end as team_id,
           case when winner = team_a then time_b else time_a end as duel_time
    from decided
    where winner is not null and team_a is not null and team_b is not null
  ) l
), eliminated as (
  select l.*,
    row_number() over (partition by race_id, stage order by duel_time nulls last) as fastest,
    bool_or(back_in) over (partition by race_id, stage) as someone_back
  from losers l
), outcomes as (
  -- Onde cada barco parou na chave: a fase em que perdeu, ou o pódio.
  select race_id, stage, team_id, duel_time
  from eliminated
  where not back_in
    -- Etapa 2: o perdedor de melhor tempo fica sem colocação até a repescagem ser lançada em C1.
    and not (stage = 'qf' and fastest = 1 and duel_time is not null and not someone_back)
  union all
  select race_id, case stage when 'final' then 'champion' else 'third_winner' end, winner,
         case when winner = team_a then time_a else time_b end
  from decided
  where stage in ('final', 'third') and winner is not null and team_a is not null and team_b is not null
), bracket as (
  select o.race_id, o.team_id, o.stage, o.duel_time,
    (case o.stage when 'champion' then 1 when 'final' then 2 when 'third_winner' then 3 when 'third' then 4
       when 'sf' then 3 when 'qf' then 5 when 'r16' then 7 else 13 end
     + rank() over (partition by o.race_id, o.stage order by o.duel_time nulls last) - 1)::int as position
  from outcomes o
), entries as (
  -- Está na prova quem tem volta, duelo ou uma linha em race_status.
  select race_id, team_id from public.race_laps
  union select race_id, team_a from public.match_duels where team_a is not null
  union select race_id, team_b from public.match_duels where team_b is not null
  union select race_id, team_id from public.race_status
), base as (
  select e.race_id, e.team_id, r.kind, coalesce(rr.status, 'ok') as status, coalesce(rr.note, '') as note,
    rr.position as manual_position, l.laps, l.last_lap_at, b.stage, b.duel_time, b.position as bracket_position
  from entries e
  join public.races r on r.id = e.race_id
  left join public.race_status rr on rr.race_id = e.race_id and rr.team_id = e.team_id
  left join laps l on l.race_id = e.race_id and l.team_id = e.team_id
  left join bracket b on b.race_id = e.race_id and b.team_id = e.team_id
), ranked as (
  -- Mais voltas vence; empate: quem fechou a última volta primeiro (edital, 10.1.5).
  select base.*,
    case when status = 'ok' then rank() over (
      partition by race_id, status = 'ok'
      order by coalesce(laps, 0) desc, last_lap_at nulls last) end::int as lap_position
  from base
)
select race_id, team_id, status, note, coalesce(laps, 0) as laps, last_lap_at, stage, duel_time, position,
  case status when 'dns' then 0 when 'dnf' then 20 else public.placement_points(position) end as points
from (
  select ranked.*,
    case when status = 'ok' then coalesce(manual_position, case kind when 'bracket' then bracket_position else lap_position end) end as position
  from ranked
) scored;
