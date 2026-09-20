-- Logo do barco: nome do arquivo em /public/logos do app (ex.: 'vento-sul.webp').
alter table public.teams add column logo text check (logo is null or logo ~ '^[a-z0-9-]{1,60}\.webp$');

create or replace view public.team_standings with (security_invoker = true) as
  select t.id, t.name, t.university, t.initials, t.color, t.tier,
         coalesce(sum(r.points), 0)::int as points, t.logo
  from public.teams t
  left join public.race_results r on r.team_id = t.id
  where t.active
  group by t.id;

update public.teams set logo = v.logo from (values
  ('ufsc', 'vento-sul.webp'), ('ufrj', 'ufrj.webp'), ('uff', 'arariboia.webp'),
  ('ifsc', 'zenite.webp'), ('ufes', 'solares.webp')
) as v(id, logo) where teams.id = v.id;
