-- Provas da programação oficial (horário de Brasília).
insert into public.races (id, number, name, starts_at) values
  ('raia-rapida', 1, 'Raia Rápida', '2026-10-13 15:00-03'),
  ('match-race', 2, 'Match Race', '2026-10-14 10:00-03'),
  ('raia-manobra', 3, 'Raia de Manobra', '2026-10-14 14:00-03'),
  ('raia-longa', 4, 'Raia Longa', '2026-10-15 08:00-03'),
  ('revezamento', 5, 'Revezamento de Pilotos', '2026-10-16 09:00-03'),
  ('sprint', 6, 'Sprint', '2026-10-17 09:00-03'),
  ('slalom', 7, 'Slalom', '2026-10-17 09:30-03')
on conflict (id) do nothing;

-- Barcos de exemplo: troque pelos inscritos reais no Table Editor do Supabase.
insert into public.teams (id, name, university, initials, color, tier) values
  ('ufsc', 'Vento Sul', 'UFSC · Florianópolis, SC', 'VS', 'green', 'A'),
  ('ufrj', 'Minerva Solar', 'UFRJ · Rio de Janeiro, RJ', 'MS', 'gold', 'A'),
  ('uff', 'Arariboia', 'UFF · Niterói, RJ', 'AR', 'blue', 'A'),
  ('ifsc', 'Zênite Solar', 'IFSC · Joinville, SC', 'ZS', 'orange', 'B'),
  ('ufes', 'Solares', 'UFES · Vitória, ES', 'SO', 'purple', 'B'),
  ('ufpe', 'Mangue Solar', 'UFPE · Recife, PE', 'MG', 'cyan', 'B'),
  ('usp', 'Raia Paulista', 'USP · São Carlos, SP', 'RP', 'blue', 'B'),
  ('ufmg', 'Sol de Minas', 'UFMG · Belo Horizonte, MG', 'SM', 'gold', 'B'),
  ('ufba', 'Maré Alta', 'UFBA · Salvador, BA', 'MA', 'green', 'C'),
  ('ufrn', 'Potiguar Solar', 'UFRN · Natal, RN', 'PS', 'orange', 'C'),
  ('ufpa', 'Iara', 'UFPA · Belém, PA', 'IA', 'cyan', 'C'),
  ('ufsm', 'Pampa Solar', 'UFSM · Santa Maria, RS', 'PA', 'purple', 'C')
on conflict (id) do nothing;
