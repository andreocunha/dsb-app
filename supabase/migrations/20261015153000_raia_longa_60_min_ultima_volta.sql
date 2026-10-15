-- Raia Longa: 60 min para fechar a última volta depois dos 240 min de prova (estava 30).
update public.races set closing_minutes = 60
where id = 'raia-longa' and duration_minutes = 240 and closing_minutes = 30;
