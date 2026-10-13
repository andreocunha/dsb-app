-- Instrução Técnica da Etapa Macaé 2026: a Prova 6 é o Slalom (17/10, 09h) e a Prova 7 é o
-- Sprint (17/10, 11h). A programação anterior era provisória (Sprint 09h como Prova 6, Slalom 09h30
-- como Prova 7), então o horário é trocado direto, sem linha em schedule_changes: não houve atraso.
-- As escalações do fantasy seguem na prova em que foram feitas (ficam presas ao id, não ao número).

-- races.number é único: o Sprint sai do caminho antes da troca.
update public.races set number = 100 where id = 'sprint';
update public.races set number = 6, starts_at = '2026-10-17 09:00-03' where id = 'slalom';
update public.races set number = 7, starts_at = '2026-10-17 11:00-03' where id = 'sprint';
