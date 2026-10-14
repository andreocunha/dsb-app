-- Largada do duelo do Match Race no banco, para o mapa mostrar o relógio do X1 a quem está assistindo.
-- O tempo oficial continua sendo o medido no aparelho da organização (largada e chegada no mesmo relógio).
alter table public.match_duels add column started_at timestamptz;
comment on column public.match_duels.started_at is 'Largada marcada no painel. Só alimenta o relógio do mapa; vazio = sem relógio.';

-- Cria o duelo com os barcos da chave se ele ainda não estiver lançado. p_at nulo tira o relógio (largada cancelada).
create function public.admin_start_duel(
  p_race_id text, p_stage text, p_slot smallint, p_team_a text, p_team_b text, p_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.races where id = p_race_id and kind = 'bracket') then raise exception 'Prova de chave não encontrada.'; end if;
  insert into public.match_duels as d (race_id, stage, slot, team_a, team_b, started_at)
  values (p_race_id, p_stage, p_slot, p_team_a, p_team_b, p_at)
  on conflict (race_id, stage, slot) do update
    set team_a = coalesce(d.team_a, excluded.team_a), team_b = coalesce(d.team_b, excluded.team_b), started_at = excluded.started_at;
end $$;

revoke execute on function public.admin_start_duel(text, text, smallint, text, text, timestamptz) from public, anon;
grant execute on function public.admin_start_duel(text, text, smallint, text, text, timestamptz) to authenticated;
