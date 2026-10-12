-- Instalações do app: uma linha por aparelho (ou navegador), para a organização saber quantas
-- pessoas têm o app, em que aparelho, quantas entraram na conta e quantas aceitaram notificações.
--
-- Download quem conta são as lojas. Aqui entra quem abriu o app pelo menos uma vez depois desta
-- migration: como o app das lojas carrega o site, quem já tinha instalado aparece na próxima abertura.
-- O id nasce no aparelho (aleatório, guardado no localStorage): reinstalar gera outra linha.

create table public.app_installs (
  id uuid primary key,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_model text check (char_length(device_model) <= 80),
  os text check (char_length(os) <= 40),
  app_version text check (char_length(app_version) <= 40),
  -- granted: liberadas; ask: ainda não respondeu; denied: recusou. Null onde não há push (navegador).
  push_status text check (push_status in ('granted', 'ask', 'denied')),
  -- Última conta que entrou por este aparelho. first_login_at continua mesmo se a conta for apagada.
  user_id uuid references auth.users(id) on delete set null,
  first_login_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index app_installs_user_idx on public.app_installs(user_id);
alter table public.app_installs enable row level security;
-- Sem policies nem grants: o aparelho escreve por track_install() e só a organização lê, por install_stats().
revoke all on public.app_installs from anon, authenticated;

-- Chamado a cada abertura do app, com ou sem login (lib/install.ts).
create function public.track_install(
  p_id uuid, p_platform text, p_model text default null, p_os text default null,
  p_app_version text default null, p_push text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if p_id is null then return; end if;
  insert into public.app_installs as i (id, platform, device_model, os, app_version, push_status, user_id, first_login_at)
  values (
    p_id, p_platform, left(nullif(trim(p_model), ''), 80), left(nullif(trim(p_os), ''), 40),
    left(nullif(trim(p_app_version), ''), 40), p_push, v_user, case when v_user is not null then now() end
  )
  on conflict (id) do update set
    platform = excluded.platform,
    device_model = coalesce(excluded.device_model, i.device_model),
    os = coalesce(excluded.os, i.os),
    app_version = coalesce(excluded.app_version, i.app_version),
    push_status = coalesce(excluded.push_status, i.push_status),
    -- Sair da conta não apaga quem entrou: a pergunta é se este aparelho já fez login.
    user_id = coalesce(excluded.user_id, i.user_id),
    first_login_at = coalesce(i.first_login_at, excluded.first_login_at),
    last_seen_at = now();
end $$;

-- Números do painel (/admin › Números). "App" é iOS e Android; o navegador entra à parte.
create function public.install_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_stats jsonb;
begin
  perform public.require_admin();
  with app as (select * from public.app_installs where platform <> 'web')
  select jsonb_build_object(
    'since', (select min(first_seen_at) from public.app_installs),
    'ios', (select count(*) from app where platform = 'ios'),
    'android', (select count(*) from app where platform = 'android'),
    'web', (select count(*) from public.app_installs where platform = 'web'),
    'logged', (select count(*) from app where first_login_at is not null),
    'push_granted', (select count(*) from app where push_status = 'granted'),
    'push_denied', (select count(*) from app where push_status = 'denied'),
    'push_ask', (select count(*) from app where push_status = 'ask'),
    'active_7d', (select count(*) from app where last_seen_at > now() - interval '7 days'),
    'accounts', (select count(*) from auth.users),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by total desc, label)
      from (select coalesce(device_model, case platform when 'ios' then 'iPhone ou iPad' else 'Android não identificado' end) as label, count(*) as total
        from app group by 1 order by 2 desc, 1 limit 30) d), '[]'::jsonb),
    'systems', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by total desc, label)
      from (select coalesce(os, 'Não identificado') as label, count(*) as total from app group by 1) s), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by total desc, label)
      from (select case platform when 'ios' then 'iOS' else 'Android' end || ' ' || coalesce(app_version, 'sem versão') as label, count(*) as total from app group by 1) v), '[]'::jsonb)
  ) into v_stats;
  return v_stats;
end $$;

revoke execute on function public.track_install(uuid, text, text, text, text, text), public.install_stats() from public, anon, authenticated;
grant execute on function public.track_install(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.install_stats() to authenticated;
