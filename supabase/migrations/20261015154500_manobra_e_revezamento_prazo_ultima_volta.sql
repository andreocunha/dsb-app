-- Prazo da última volta pela regra 10.1 (1/3 da prova ou 1 h, o que for menor); as duas estavam com 30.
-- Raia Manobra (120 min) → 40 min; Revezamento (180 min) → 60 min.
update public.races set closing_minutes = case id when 'raia-manobra' then 40 when 'revezamento' then 60 end
where (id = 'raia-manobra' and duration_minutes = 120 and closing_minutes = 30)
   or (id = 'revezamento' and duration_minutes = 180 and closing_minutes = 30)
returning id, duration_minutes, closing_minutes;
