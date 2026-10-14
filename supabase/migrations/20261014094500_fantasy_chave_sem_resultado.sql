-- Chave do Match Race lançada antes da prova põe os barcos em race_scores, ainda sem colocação.
-- O fantasy lia isso como "Resultado publicado" e escondia o 2x. Conta só barco com colocação ou DNF/DNS.
create or replace view public.race_results with (security_invoker = true) as
select race_id, team_id, points
from public.race_scores
where status <> 'ok' or position is not null;
