-- Slalom e Sprint pela Instrução Técnica de 2026: são provas de tempo, não de voltas.
--
--   Slalom (attempts): um barco por vez, até 3 tentativas por equipe; vale o melhor tempo.
--     O próximo larga até 3 min depois da chegada do anterior; o tempo conta quando o barco
--     abre a volta ou ao fim dos 3 min (o painel aplica a regra na hora da largada).
--   Sprint (heats): todos largam juntos e a classificação é pelo tempo de chegada (bateria 1).
--     Os 3 primeiros fazem a bateria 2, que define o pódio; do 4º em diante vale a bateria 1.
--
-- Uma linha de race_runs é uma tentativa (Slalom) ou a participação numa bateria (Sprint):
--   seconds preenchido          tempo válido
--   started_at sem ended_at     barco na água agora (relógio do painel e do mapa)
--   o resto                     terminou sem tempo (não completou, errou o percurso)
-- Equipe que largou e não tem nenhum tempo válido fica DNF sozinha (20 pontos), sem precisar marcar.

alter table public.races drop constraint races_kind_check;
alter table public.races add constraint races_kind_check check (kind in ('laps', 'bracket', 'attempts', 'heats'));
update public.races set kind = 'attempts' where id = 'slalom';
update public.races set kind = 'heats' where id = 'sprint';

create table public.race_runs (
  race_id text not null references public.races(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  run smallint not null check (run between 1 and 3),
  started_at timestamptz,
  ended_at timestamptz,
  seconds numeric(7, 2) check (seconds > 0),
  primary key (race_id, team_id, run)
);
comment on column public.race_runs.run is 'Número da tentativa (Slalom, 1 a 3) ou da bateria (Sprint, 1 ou 2).';
comment on column public.race_runs.seconds is 'Tempo oficial, em segundos, medido no aparelho da organização. Vazio = sem tempo.';

alter table public.race_runs enable row level security;
create policy race_runs_read on public.race_runs for select to anon, authenticated using (true);
grant select on public.race_runs to anon, authenticated;
alter publication supabase_realtime add table public.race_runs;

-- ---------------------------------------------------------------------
-- Painel da organização
-- ---------------------------------------------------------------------
create function public.timed_race_runs(p_race_id text) returns smallint
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text;
begin
  select kind into v_kind from public.races where id = p_race_id;
  if v_kind is null or v_kind not in ('attempts', 'heats') then raise exception 'Prova de tempo não encontrada.'; end if;
  return case v_kind when 'heats' then 2 else 3 end;
end $$;
revoke execute on function public.timed_race_runs(text) from public, anon, authenticated;

-- Largada de um barco (Slalom) ou da bateria inteira (Sprint). Largar de novo recomeça a tentativa.
create function public.admin_start_runs(p_race_id text, p_run smallint, p_team_ids text[], p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_run < 1 or p_run > public.timed_race_runs(p_race_id) then raise exception 'Tentativa ou bateria inválida.'; end if;
  if p_at is null then raise exception 'Informe o horário da largada.'; end if;
  insert into public.race_runs (race_id, team_id, run, started_at)
  select p_race_id, team_id, p_run, p_at from unnest(p_team_ids) as t(team_id)
  on conflict (race_id, team_id, run) do update set started_at = excluded.started_at, ended_at = null, seconds = null;
end $$;

-- Chegada com tempo, ou fim sem tempo (p_seconds nulo). Serve também para digitar ou corrigir um
-- tempo à mão: o horário de chegada já gravado não muda.
create function public.admin_set_run(p_race_id text, p_team_id text, p_run smallint, p_seconds numeric, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_run < 1 or p_run > public.timed_race_runs(p_race_id) then raise exception 'Tentativa ou bateria inválida.'; end if;
  insert into public.race_runs as r (race_id, team_id, run, ended_at, seconds)
  values (p_race_id, p_team_id, p_run, coalesce(p_at, now()), p_seconds)
  on conflict (race_id, team_id, run) do update set seconds = excluded.seconds, ended_at = coalesce(r.ended_at, excluded.ended_at);
end $$;

-- Encerra a bateria: quem ainda está na água fica sem tempo.
create function public.admin_close_runs(p_race_id text, p_run smallint, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.timed_race_runs(p_race_id);
  update public.race_runs set ended_at = coalesce(p_at, now())
  where race_id = p_race_id and run = p_run and started_at is not null and ended_at is null and seconds is null;
end $$;

create function public.admin_delete_run(p_race_id text, p_team_id text, p_run smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.race_runs where race_id = p_race_id and team_id = p_team_id and run = p_run;
end $$;

revoke execute on function public.admin_start_runs(text, smallint, text[], timestamptz) from public, anon;
revoke execute on function public.admin_set_run(text, text, smallint, numeric, timestamptz) from public, anon;
revoke execute on function public.admin_close_runs(text, smallint, timestamptz) from public, anon;
revoke execute on function public.admin_delete_run(text, text, smallint) from public, anon;
grant execute on function public.admin_start_runs(text, smallint, text[], timestamptz) to authenticated;
grant execute on function public.admin_set_run(text, text, smallint, numeric, timestamptz) to authenticated;
grant execute on function public.admin_close_runs(text, smallint, timestamptz) to authenticated;
grant execute on function public.admin_delete_run(text, text, smallint) to authenticated;

-- ---------------------------------------------------------------------
-- Colocação: voltas e chave seguem iguais; entram o Slalom e o Sprint.
-- Colunas novas no fim: runs (tentativas ou baterias) e run_time (o tempo que decide a colocação).
-- ---------------------------------------------------------------------
create or replace view public.race_scores with (security_invoker = true) as
with laps as (
  select race_id, team_id, count(*)::int as laps, max(completed_at) as last_lap_at
  from public.race_laps group by race_id, team_id
), runs as (
  select race_id, team_id, count(*)::int as runs,
    min(seconds) as best,
    min(seconds) filter (where run = 1) as heat1,
    min(seconds) filter (where run = 2) as heat2,
    bool_or(run = 2) as in_final,
    bool_or(seconds is null and ended_at is null and started_at is not null) as running
  from public.race_runs group by race_id, team_id
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
  -- Está na prova quem tem volta, duelo, tentativa/bateria ou uma linha em race_status.
  select race_id, team_id from public.race_laps
  union select race_id, team_a from public.match_duels where team_a is not null
  union select race_id, team_b from public.match_duels where team_b is not null
  union select race_id, team_id from public.race_runs
  union select race_id, team_id from public.race_status
), base as (
  select e.race_id, e.team_id, r.kind,
    case
      when rr.status in ('dnf', 'dns') then rr.status
      -- Largou e não fez nenhum tempo válido (e não está na água agora): DNF.
      when r.kind in ('attempts', 'heats') and u.runs > 0 and u.best is null and not u.running and rr.position is null then 'dnf'
      else 'ok'
    end as status,
    coalesce(rr.note, '') as note,
    rr.position as manual_position, l.laps, l.last_lap_at, b.stage, b.duel_time, b.position as bracket_position,
    u.runs, u.best, u.heat1, u.heat2, coalesce(u.in_final, false) as in_final
  from entries e
  join public.races r on r.id = e.race_id
  left join public.race_status rr on rr.race_id = e.race_id and rr.team_id = e.team_id
  left join laps l on l.race_id = e.race_id and l.team_id = e.team_id
  left join bracket b on b.race_id = e.race_id and b.team_id = e.team_id
  left join runs u on u.race_id = e.race_id and u.team_id = e.team_id
), ranked as (
  select base.*,
    -- Mais voltas vence; empate: quem fechou a última volta primeiro (edital, 10.1.5).
    case when status = 'ok' then rank() over (
      partition by race_id, status = 'ok'
      order by coalesce(laps, 0) desc, last_lap_at nulls last) end::int as lap_position,
    -- Slalom: melhor tempo entre as tentativas.
    case when status = 'ok' and best is not null then rank() over (
      partition by race_id, status = 'ok' and best is not null
      order by best) end::int as attempt_position,
    -- Sprint: quem está na bateria 2 fica à frente, pela bateria 2; os outros, pela bateria 1.
    case when status = 'ok' and best is not null then rank() over (
      partition by race_id, status = 'ok' and best is not null
      order by in_final desc, heat2 nulls last, heat1 nulls last) end::int as heat_position
  from base
)
select race_id, team_id, status, note, coalesce(laps, 0) as laps, last_lap_at, stage, duel_time, position,
  case status when 'dns' then 0 when 'dnf' then 20 else public.placement_points(position) end as points,
  coalesce(runs, 0) as runs,
  case kind when 'attempts' then best when 'heats' then case when in_final then heat2 else heat1 end end as run_time
from (
  select ranked.*,
    case when status = 'ok' then coalesce(manual_position, case kind
      when 'bracket' then bracket_position when 'attempts' then attempt_position when 'heats' then heat_position
      else lap_position end) end as position
  from ranked
) scored;
