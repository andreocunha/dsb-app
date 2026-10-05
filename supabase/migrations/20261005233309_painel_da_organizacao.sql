-- Painel da organização (/admin): voltas, situação dos barcos, Match Race, pontos extras,
-- penalidades, notificação geral e o link da live, tudo pelo app.
--
-- Quem pode usar: as contas cujo e-mail está em admin_emails. Para liberar alguém:
--   insert into public.admin_emails (email) values ('pessoa@exemplo.com');
-- Vale assim que a pessoa entrar com esse e-mail (Google, Apple ou e-mail e senha).

-- ---------------------------------------------------------------------
-- Quem é da organização
-- ---------------------------------------------------------------------
create table public.admin_emails (
  email text primary key check (email = lower(trim(email))),
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
-- Sem policies nem grants: a lista só é lida por is_admin().
revoke all on public.admin_emails from anon, authenticated;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u join public.admin_emails a on a.email = lower(u.email)
    where u.id = (select auth.uid())
  )
$$;

create function public.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só a organização pode fazer isso.' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Link da live: uma linha só, lida por todo mundo e trocada pelo painel
-- ---------------------------------------------------------------------
create table public.event_settings (
  id boolean primary key default true check (id),
  live_url text not null default '' check (live_url = '' or live_url ~ '^https://'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.event_settings default values;
alter table public.event_settings enable row level security;
create policy event_settings_read on public.event_settings for select to anon, authenticated using (true);
grant select on public.event_settings to anon, authenticated;
-- Trocar o link troca a transmissão de quem já está com a live aberta.
alter publication supabase_realtime add table public.event_settings;

create function public.set_live_url(p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text := trim(coalesce(p_url, ''));
begin
  perform public.require_admin();
  if v_url <> '' and v_url !~ '^https://' then raise exception 'Use um link https:// do YouTube.'; end if;
  update public.event_settings set live_url = v_url, updated_at = now(), updated_by = auth.uid() where id;
end $$;

-- ---------------------------------------------------------------------
-- Provas de voltas
-- ---------------------------------------------------------------------
-- Volta fechada agora (ou no horário informado, para lançar uma que ficou para trás).
-- Em milissegundos, que é a precisão com que o app lê e devolve o horário para apagar.
create function public.admin_add_lap(p_race_id text, p_team_id text, p_at timestamptz default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz := date_trunc('milliseconds', coalesce(p_at, now()));
begin
  perform public.require_admin();
  if not exists (select 1 from public.races where id = p_race_id and kind = 'laps') then raise exception 'Prova de voltas não encontrada.'; end if;
  insert into public.race_laps (race_id, team_id, completed_at) values (p_race_id, p_team_id, v_at);
  return v_at;
exception when unique_violation then
  raise exception 'Essa volta já foi lançada.';
end $$;

create function public.admin_remove_lap(p_race_id text, p_team_id text, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.race_laps
  where race_id = p_race_id and team_id = p_team_id and date_trunc('milliseconds', completed_at) = date_trunc('milliseconds', p_at);
  if not found then raise exception 'Volta não encontrada.'; end if;
end $$;

-- Largada de verdade (base do tempo da primeira volta). Nulo volta para o horário previsto.
create function public.admin_set_race_start(p_race_id text, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.races set started_at = p_at where id = p_race_id;
  if not found then raise exception 'Prova não encontrada.'; end if;
end $$;

-- Exceções da prova: DNF, DNS, colocação à mão e observação. Tudo padrão apaga a linha.
create function public.admin_set_race_status(p_race_id text, p_team_id text, p_status text, p_position smallint default null, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare v_note text := trim(coalesce(p_note, ''));
begin
  perform public.require_admin();
  if p_status not in ('ok', 'dnf', 'dns') then raise exception 'Situação inválida.'; end if;
  if p_status = 'ok' and p_position is null and v_note = '' then
    delete from public.race_status where race_id = p_race_id and team_id = p_team_id;
    return;
  end if;
  insert into public.race_status (race_id, team_id, status, position, note)
  values (p_race_id, p_team_id, p_status, case when p_status = 'ok' then p_position end, v_note)
  on conflict (race_id, team_id) do update set status = excluded.status, position = excluded.position, note = excluded.note;
end $$;

-- ---------------------------------------------------------------------
-- Match Race
-- ---------------------------------------------------------------------
create function public.admin_save_duel(
  p_race_id text, p_stage text, p_slot smallint,
  p_team_a text, p_team_b text, p_time_a numeric default null, p_time_b numeric default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if not exists (select 1 from public.races where id = p_race_id and kind = 'bracket') then raise exception 'Prova de chave não encontrada.'; end if;
  if p_team_a is not null and p_team_a = p_team_b then raise exception 'Escolha dois barcos diferentes.'; end if;
  insert into public.match_duels (race_id, stage, slot, team_a, team_b, time_a, time_b)
  values (p_race_id, p_stage, p_slot, p_team_a, p_team_b, p_time_a, p_time_b)
  on conflict (race_id, stage, slot) do update
    set team_a = excluded.team_a, team_b = excluded.team_b, time_a = excluded.time_a, time_b = excluded.time_b;
end $$;

create function public.admin_delete_duel(p_race_id text, p_stage text, p_slot smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.match_duels where race_id = p_race_id and stage = p_stage and slot = p_slot;
end $$;

-- ---------------------------------------------------------------------
-- Pontos fora das provas e penalidades
-- ---------------------------------------------------------------------
create function public.admin_set_team_extras(p_team_id text, p_docs smallint, p_article boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.teams set docs_delivered = p_docs, article_delivered = p_article where id = p_team_id;
  if not found then raise exception 'Equipe não encontrada.'; end if;
end $$;

create function public.admin_add_penalty(p_team_id text, p_points smallint, p_reason text, p_race_id text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform public.require_admin();
  insert into public.penalties (team_id, race_id, points, reason)
  values (p_team_id, p_race_id, -abs(p_points), trim(p_reason))
  returning id into v_id;
  return v_id;
end $$;

create function public.admin_delete_penalty(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.penalties where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Notificação geral
-- ---------------------------------------------------------------------
-- Vai para todo mundo que deixou "Anúncios gerais" ligado (send-push, modo aviso).
-- Como nos outros avisos, o pg_net só chama a função depois do commit.
create function public.send_announcement(p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_segredo text; v_title text := trim(coalesce(p_title, '')); v_body text := trim(coalesce(p_body, ''));
begin
  perform public.require_admin();
  if char_length(v_title) not between 1 and 65 then raise exception 'O título precisa ter entre 1 e 65 caracteres.'; end if;
  if char_length(v_body) not between 1 and 240 then raise exception 'O texto precisa ter entre 1 e 240 caracteres.'; end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cron_secret';
  if v_segredo is null then raise exception 'Notificações não configuradas: crie o segredo cron_secret no Vault.'; end if;
  perform net.http_post(
    url := 'https://ztzmvdmggxyokfbakajq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_segredo),
    body := jsonb_build_object('modo', 'aviso', 'titulo', v_title, 'texto', v_body)
  );
end $$;

-- Últimos recados enviados (o send-push registra cada um em push_log).
create function public.recent_announcements(p_limit int default 10)
returns table (title text, sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.titulo, l.sent_at from public.push_log l
  where l.chave like 'aviso:%' and public.is_admin()
  order by l.sent_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function
  public.is_admin(), public.require_admin(), public.set_live_url(text),
  public.admin_add_lap(text, text, timestamptz), public.admin_remove_lap(text, text, timestamptz),
  public.admin_set_race_start(text, timestamptz), public.admin_set_race_status(text, text, text, smallint, text),
  public.admin_save_duel(text, text, smallint, text, text, numeric, numeric), public.admin_delete_duel(text, text, smallint),
  public.admin_set_team_extras(text, smallint, boolean), public.admin_add_penalty(text, smallint, text, text),
  public.admin_delete_penalty(bigint), public.send_announcement(text, text), public.recent_announcements(int)
from public, anon;
grant execute on function
  public.is_admin(), public.set_live_url(text),
  public.admin_add_lap(text, text, timestamptz), public.admin_remove_lap(text, text, timestamptz),
  public.admin_set_race_start(text, timestamptz), public.admin_set_race_status(text, text, text, smallint, text),
  public.admin_save_duel(text, text, smallint, text, text, numeric, numeric), public.admin_delete_duel(text, text, smallint),
  public.admin_set_team_extras(text, smallint, boolean), public.admin_add_penalty(text, smallint, text, text),
  public.admin_delete_penalty(bigint), public.send_announcement(text, text), public.recent_announcements(int)
to authenticated;
revoke execute on function public.require_admin() from authenticated;
