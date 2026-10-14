-- Chegada de um barco no X1, marcada com um toque no painel: grava só o tempo daquele lado,
-- para dois toques quase juntos (chegada apertada) não se atropelarem.
-- Cria o duelo com os barcos da chave se ele ainda não estiver lançado. p_seconds nulo desfaz a chegada.
create function public.admin_set_duel_time(
  p_race_id text, p_stage text, p_slot smallint, p_team_a text, p_team_b text, p_side text, p_seconds numeric
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.races where id = p_race_id and kind = 'bracket') then raise exception 'Prova de chave não encontrada.'; end if;
  if p_side not in ('a', 'b') then raise exception 'Lado do duelo inválido.'; end if;
  insert into public.match_duels as d (race_id, stage, slot, team_a, team_b, time_a, time_b)
  values (p_race_id, p_stage, p_slot, p_team_a, p_team_b,
    case when p_side = 'a' then p_seconds end, case when p_side = 'b' then p_seconds end)
  on conflict (race_id, stage, slot) do update
    set team_a = coalesce(d.team_a, excluded.team_a), team_b = coalesce(d.team_b, excluded.team_b),
        time_a = case when p_side = 'a' then excluded.time_a else d.time_a end,
        time_b = case when p_side = 'b' then excluded.time_b else d.time_b end;
end $$;

revoke execute on function public.admin_set_duel_time(text, text, smallint, text, text, text, numeric) from public, anon;
grant execute on function public.admin_set_duel_time(text, text, smallint, text, text, text, numeric) to authenticated;
