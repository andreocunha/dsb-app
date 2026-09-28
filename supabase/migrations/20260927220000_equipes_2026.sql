-- Equipes inscritas na Etapa Macaé 2026 (lista do formulário oficial).
-- Quem não está na lista fica inativo, e não apagado: o tracker guarda histórico por equipe.
-- Equipe inativa some do app, do mapa ao vivo e do fantasy.

insert into public.teams (id, name, initials, color, logo, active) values
  ('abissol', 'Abissol', 'ABI', 'cyan', null, true),
  ('arariboia', 'Arariboia', 'ARA', 'blue', 'arariboia.webp', true),
  ('babitonga', 'Babitonga', 'BAB', 'orange', 'babitonga.webp', true),
  ('fernando-amorim', 'Fernando Amorim', 'FA', 'green', 'fernando-amorim.webp', true),
  ('gune', 'Güneş', 'GUN', 'gold', 'gune.webp', true),
  ('hefesto', 'Hefesto', 'HEF', 'orange', null, true),
  ('hurakan', 'Hurakan', 'HUR', 'blue', 'hurakan.webp', true),
  ('leviata', 'Leviatã', 'LEV', 'cyan', 'leviata.webp', true),
  ('solares', 'Projeto Solares', 'SOL', 'orange', 'solares.webp', true),
  ('reis-do-sol', 'Reis do Sol', 'RDS', 'purple', 'reis-do-sol.webp', true),
  ('sete-capitaes', 'Sete Capitães', 'SC', 'green', 'sete-capitaes.webp', true),
  ('solaris', 'Solaris', 'SOL', 'purple', 'solaris.webp', true),
  ('solmar-celeris', 'SolMar Celeris', 'SMC', 'blue', null, true),
  ('unisolares', 'UNISOLARES', 'UNI', 'gold', null, true),
  ('zenite', 'Zênite Solar', 'ZEN', 'orange', 'zenite.webp', true)
on conflict (id) do update
  set name = excluded.name, active = true, logo = coalesce(public.teams.logo, excluded.logo);

update public.teams set active = false
where id not in ('abissol', 'arariboia', 'babitonga', 'fernando-amorim', 'gune', 'hefesto', 'hurakan', 'leviata',
  'solares', 'reis-do-sol', 'sete-capitaes', 'solaris', 'solmar-celeris', 'unisolares', 'zenite');
