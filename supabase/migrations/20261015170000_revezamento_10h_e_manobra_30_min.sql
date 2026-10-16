-- Conferido com a Instrução Técnica da Etapa Macaé 2026:
-- Revezamento de Pilotos larga às 10h de sexta (16/10), não às 9h (correção de cadastro, sem
-- linha em schedule_changes para não aparecer como remarcada). Raia de Manobra tinha limite às
-- 16h30 (2 h de prova + 30 min), e não 40 min como a regra geral daria.
update public.races set starts_at = '2026-10-16 10:00-03'
where id = 'revezamento' and starts_at = '2026-10-16 09:00-03' and started_at is null;
update public.races set closing_minutes = 30
where id = 'raia-manobra' and duration_minutes = 120 and closing_minutes = 40;
