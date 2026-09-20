-- Barcos reais da competição: nomes e logos oficiais.
-- O fantasy v2 não usa tiers, então a coluna sai junto.

-- Sai a escalação de teste e os 12 barcos de demonstração.
delete from public.fantasy_lineups where race_id in (select id from public.races);
delete from public.teams where id in
  ('ufsc', 'ufrj', 'uff', 'ifsc', 'ufes', 'ufpe', 'usp', 'ufmg', 'ufba', 'ufrn', 'ufpa', 'ufsm');

drop view public.team_standings;
alter table public.teams drop column tier;
create view public.team_standings with (security_invoker = true) as
  select t.id, t.name, t.university, t.initials, t.color, t.logo,
         coalesce(sum(r.points), 0)::int as points
  from public.teams t
  left join public.race_results r on r.team_id = t.id
  where t.active
  group by t.id;
grant select on public.team_standings to anon, authenticated;

insert into public.teams (id, name, initials, color, logo) values
  ('adsumus', 'Adsumus', 'ADS', 'green', 'adsumus.webp'),
  ('albardao', 'Albardão', 'ALB', 'gold', 'albardao.webp'),
  ('arariboia', 'Arariboia', 'ARA', 'blue', 'arariboia.webp'),
  ('babitonga', 'Babitonga', 'BAB', 'orange', 'babitonga.webp'),
  ('buzios-bardot', 'Búzios Bardot', 'BB', 'purple', 'buzios-bardot.webp'),
  ('etehl', 'ETEHL', 'ETE', 'cyan', 'etehl.webp'),
  ('fernando-amorim', 'Fernando Amorim', 'FA', 'green', 'fernando-amorim.webp'),
  ('gune', 'GUNE', 'GUN', 'gold', 'gune.webp'),
  ('hurakan', 'Hurakan', 'HUR', 'blue', 'hurakan.webp'),
  ('jaraquio', 'Jaraquió', 'JAR', 'orange', 'jaraquio.webp'),
  ('lafae', 'LAFAE', 'LAF', 'purple', 'lafae.webp'),
  ('leviata', 'Leviatã', 'LEV', 'cyan', 'leviata.webp'),
  ('msp', 'MSP', 'MSP', 'green', 'msp.webp'),
  ('muiraquita', 'Muiraquitã', 'MUI', 'gold', 'muiraquita.webp'),
  ('nides', 'NIDES', 'NID', 'blue', 'nides.webp'),
  ('poli-nautico', 'Poli Náutico', 'PN', 'orange', 'poli-nautico.webp'),
  ('reis-do-sol', 'Reis do Sol', 'RDS', 'purple', 'reis-do-sol.webp'),
  ('sagre', 'SAGRE', 'SAG', 'cyan', 'sagre.webp'),
  ('sete-capitaes', 'Sete Capitães', 'SC', 'green', 'sete-capitaes.webp'),
  ('smart', 'Smart', 'SMA', 'gold', 'smart.webp'),
  ('solamazon', 'SolAmazon', 'SOL', 'blue', 'solamazon.webp'),
  ('solares', 'Solares', 'SOL', 'orange', 'solares.webp'),
  ('solaris', 'Solaris', 'SOL', 'purple', 'solaris.webp'),
  ('solaris-cabo-frio', 'Solaris Cabo Frio', 'SCF', 'cyan', 'solaris-cabo-frio.webp'),
  ('team-brazil', 'Team Brazil', 'TB', 'green', 'team-brazil.webp'),
  ('ufrj', 'UFRJ', 'UFR', 'gold', 'ufrj.webp'),
  ('vento-sul', 'Vento Sul', 'VS', 'blue', 'vento-sul.webp'),
  ('zenite', 'Zênite', 'ZEN', 'orange', 'zenite.webp');
