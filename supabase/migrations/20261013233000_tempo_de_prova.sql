-- Tempo de prova mudado pela organização (prova encurtada por vento, atraso na raia): o relógio
-- regressivo, o prazo da última volta e o fim automático da prova seguem o valor novo na hora,
-- porque races já está no tempo real.
--
-- p_minutes nulo deixa a prova sem tempo fixo (vale até a organização encerrar).
-- Atenção: a classificação geral desempata pela prova de maior duration_minutes (team_standings).
create function public.admin_set_race_duration(p_race_id text, p_minutes int, p_closing_minutes int default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 1440) then raise exception 'Tempo de prova inválido.'; end if;
  if p_closing_minutes is not null and (p_closing_minutes < 0 or p_closing_minutes > 240) then raise exception 'Prazo da última volta inválido.'; end if;
  update public.races
    set duration_minutes = p_minutes, closing_minutes = case when p_minutes is null then null else p_closing_minutes end
    where id = p_race_id;
  if not found then raise exception 'Prova não encontrada.'; end if;
end $$;

revoke execute on function public.admin_set_race_duration(text, int, int) from public, anon;
grant execute on function public.admin_set_race_duration(text, int, int) to authenticated;
