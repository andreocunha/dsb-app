-- Resultados completos da etapa, seguindo o edital de Macaé 2026:
-- voltas com horário, duelos do Match Race, DNF/DNS, documentação, artigo e penalidades.
-- Os pontos deixam de ser digitados: saem da colocação pela tabela do item 10.2.
--
-- O que a organização preenche no Table Editor:
--   race_laps     uma linha por volta completada (barco + horário). A colocação sai daqui.
--   match_duels   um duelo do Match Race por linha, com o tempo de cada barco em segundos.
--   race_status   só as exceções: DNF, DNS ou uma colocação definida à mão.
--   teams         itens de documentação entregues (0 a 7) e se entregou o artigo.
--   penalties     penalidades, com o motivo.
--
-- race_results vira uma view com os pontos de todos os barcos, no mesmo formato de antes:
-- é o que o fantasy das versões já publicadas do app lê.

-- ---------------------------------------------------------------------
-- Provas
-- ---------------------------------------------------------------------
alter table public.races
  add column kind text not null default 'laps' check (kind in ('laps', 'bracket')),
  add column duration_minutes smallint check (duration_minutes > 0),
  add column started_at timestamptz;
comment on column public.races.duration_minutes is 'Tempo com o gate aberto. A prova com o maior valor desempata a classificação geral.';
comment on column public.races.started_at is 'Largada de verdade. Vazio = starts_at. Base para o tempo da primeira volta.';
update public.races set kind = 'bracket' where id = 'match-race';

-- Pontos por colocação (edital, item 10.2). A tabela vai até o 15º;
-- do 16º em diante vale 50 até a organização definir outra regra.
create function public.placement_points(p_position int) returns int
language sql immutable set search_path = '' as $$
  select case when p_position is null then 0
    else coalesce((array[150, 140, 130, 120, 110, 100, 90, 85, 80, 75, 70, 65, 60, 55, 50])[p_position], 50) end
$$;

-- ---------------------------------------------------------------------
-- Dados de prova
-- ---------------------------------------------------------------------
-- A volta é numerada pela ordem dos horários, então apagar uma volta errada renumera as outras.
create table public.race_laps (
  race_id text not null references public.races(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  completed_at timestamptz not null,
  primary key (race_id, team_id, completed_at)
);

-- Chave do Match Race. Na fase seguinte, o duelo N recebe os vencedores dos duelos 2N-1 e 2N.
-- Sem team_b é um bye: team_a passa direto. Vence o menor tempo; sem tempo, perde o duelo.
create table public.match_duels (
  race_id text not null references public.races(id) on delete cascade,
  stage text not null check (stage in ('r32', 'r16', 'qf', 'sf', 'third', 'final')),
  slot smallint not null check (slot > 0),
  team_a text references public.teams(id) on delete set null,
  team_b text references public.teams(id) on delete set null,
  time_a numeric(7, 2) check (time_a > 0),
  time_b numeric(7, 2) check (time_b > 0),
  primary key (race_id, stage, slot),
  check (team_a is distinct from team_b)
);
comment on column public.match_duels.time_a is 'Tempo do team_a no X1, em segundos.';

-- A tabela de resultados passa a guardar só a situação do barco; os pontos são calculados em race_scores.
alter table public.race_results rename to race_status;
alter index public.race_results_team_idx rename to race_status_team_idx;
alter policy race_results_read on public.race_status rename to race_status_read;
alter table public.race_status
  add column status text not null default 'ok' check (status in ('ok', 'dnf', 'dns')),
  add column position smallint check (position > 0),
  add column note text not null default '' check (char_length(note) <= 200);
comment on column public.race_status.position is 'Só para corrigir à mão. Vazio = colocação calculada pelas voltas ou pela chave.';

-- Pontos fora das provas (edital, itens 3.4 e 4.4): 20 por item entregue no prazo.
alter table public.teams
  add column docs_delivered smallint not null default 0 check (docs_delivered between 0 and 7),
  add column article_delivered boolean not null default false;

-- Penalidades (edital, itens 10.5 a 10.7). São cumulativas.
create table public.penalties (
  id bigint generated always as identity primary key,
  team_id text not null references public.teams(id) on delete cascade,
  race_id text references public.races(id) on delete set null,
  points smallint not null check (points < 0),
  reason text not null check (char_length(reason) between 1 and 120),
  created_at timestamptz not null default now()
);
create index penalties_team_idx on public.penalties(team_id);

-- ---------------------------------------------------------------------
-- Colocação e pontos de cada barco em cada prova
-- ---------------------------------------------------------------------
create view public.race_scores with (security_invoker = true) as
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
), outcomes as (
  -- Onde cada barco parou na chave: a fase em que perdeu, ou o pódio.
  select race_id, stage, case when winner = team_a then team_b else team_a end as team_id,
         case when winner = team_a then time_b else time_a end as duel_time
  from decided d
  where winner is not null and team_a is not null and team_b is not null
    -- Com disputa de 3º, quem perdeu na semi é colocado por ela.
    and not (stage = 'sf' and exists (select 1 from decided t where t.race_id = d.race_id and t.stage = 'third' and t.winner is not null))
  union all
  select race_id, case stage when 'final' then 'champion' else 'third_winner' end, winner,
         case when winner = team_a then time_a else time_b end
  from decided where stage in ('final', 'third') and winner is not null
), bracket as (
  select o.race_id, o.team_id, o.stage, o.duel_time,
    (case o.stage when 'champion' then 1 when 'final' then 2 when 'third_winner' then 3 when 'third' then 4
       when 'sf' then 3 when 'qf' then 5 when 'r16' then 9 else 17 end
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

-- Classificação geral: provas + documentação + artigo + penalidades.
drop view public.team_standings;
alter table public.race_status drop column points;
create view public.team_standings with (security_invoker = true) as
  select t.id, t.name, t.university, t.initials, t.color, t.logo,
    coalesce(s.race_points, 0) + t.docs_delivered * 20 + (case when t.article_delivered then 20 else 0 end)
      + coalesce(p.penalty_points, 0) as points,
    coalesce(s.race_points, 0) as race_points,
    t.docs_delivered, t.article_delivered,
    coalesce(p.penalty_points, 0) as penalty_points,
    -- Desempate da geral: colocação na prova mais longa (edital, 10.1.7).
    (select rs.position from public.race_scores rs
     where rs.team_id = t.id
       and rs.race_id = (select id from public.races order by duration_minutes desc nulls last, number limit 1)) as tiebreak_position
  from public.teams t
  left join (select team_id, sum(points)::int as race_points from public.race_scores group by team_id) s on s.team_id = t.id
  left join (select team_id, sum(points)::int as penalty_points from public.penalties group by team_id) p on p.team_id = t.id
  where t.active;

-- Fantasy: mesma regra de antes, com os pontos vindos de race_scores.
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
    select s.user_id, pr.name, pr.avatar_url, s.points, rank() over (order by s.points desc) as "position"
    from scores s join public.profiles pr on pr.id = s.user_id
  )
  select * from ranked
  where "position" <= least(greatest(p_limit, 1), 500) or ranked.user_id = auth.uid()
  order by "position", name;
$$;

-- ---------------------------------------------------------------------
-- RLS, permissões e realtime
-- ---------------------------------------------------------------------
alter table public.race_laps enable row level security;
alter table public.match_duels enable row level security;
alter table public.penalties enable row level security;
create policy race_laps_read on public.race_laps for select to anon, authenticated using (true);
create policy match_duels_read on public.match_duels for select to anon, authenticated using (true);
create policy penalties_read on public.penalties for select to anon, authenticated using (true);

-- Mesmo nome e colunas de antes, para o app que já está nas lojas.
create view public.race_results with (security_invoker = true) as
  select race_id, team_id, points from public.race_scores;

grant select on public.race_laps, public.match_duels, public.penalties, public.race_status,
  public.race_scores, public.race_results, public.team_standings to anon, authenticated;
revoke execute on function public.placement_points(int) from public;
grant execute on function public.placement_points(int) to anon, authenticated;

-- A tela de resultados se atualiza sozinha enquanto a prova acontece.
alter publication supabase_realtime add table public.race_laps, public.match_duels, public.race_status, public.penalties;
