-- Aberturas do app: em que dias cada aparelho abriu e quantas vezes, para a organização ver
-- quantos usam por dia e quantos voltam. Não custa nada a mais de internet: quem conta é o
-- track_install() que o app já chama. Uma abertura é uma visita com mais de 30 minutos desde a anterior.

create table public.app_install_days (
  install_id uuid not null references public.app_installs(id) on delete cascade,
  -- Dia no horário de Brasília.
  day date not null,
  opens int not null default 1,
  primary key (install_id, day)
);
alter table public.app_install_days enable row level security;
-- Sem policies nem grants: só track_install() escreve e só install_stats() lê.
revoke all on public.app_install_days from anon, authenticated;

-- Quem já estava registrado entra com uma abertura no dia em que apareceu.
insert into public.app_install_days (install_id, day)
select id, (first_seen_at at time zone 'America/Sao_Paulo')::date from public.app_installs;

create or replace function public.track_install(
  p_id uuid, p_platform text, p_model text default null, p_os text default null,
  p_app_version text default null, p_push text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_last timestamptz;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_id is null then return; end if;
  -- A linha fica travada até o fim: duas chamadas da mesma abertura não contam em dobro.
  select last_seen_at into v_last from public.app_installs where id = p_id for update;
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
  if v_last is null then
    insert into public.app_install_days (install_id, day) values (p_id, v_today) on conflict do nothing;
  elsif v_last < now() - interval '30 minutes' then
    insert into public.app_install_days as d (install_id, day) values (p_id, v_today)
    on conflict (install_id, day) do update set opens = d.opens + 1;
  end if;
end $$;

-- Números do painel (/admin › Números). "App" é iOS e Android; o navegador entra à parte.
create or replace function public.install_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_stats jsonb;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.require_admin();
  with app as (select * from public.app_installs where platform <> 'web'),
  app_days as (select d.* from public.app_install_days d join app a on a.id = d.install_id)
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
      from (select case platform when 'ios' then 'iOS' else 'Android' end || ' ' || coalesce(app_version, 'sem versão') as label, count(*) as total from app group by 1) v), '[]'::jsonb),
    -- Últimos 14 dias: aparelhos que abriram o app em cada dia e quantas aberturas somaram.
    'days', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(day, 'DD/MM'), 'total', total, 'opens', opens) order by day desc)
      from (select day, count(*) as total, sum(opens) as opens from app_days where day > v_today - 14 group by 1) x), '[]'::jsonb),
    -- Quantos aparelhos abriram o app 1 vez, de 2 a 5, de 6 a 20 ou mais de 20.
    'frequency', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by ord)
      from (select ord, label, count(*) as total
        from (select case when n = 1 then 1 when n <= 5 then 2 when n <= 20 then 3 else 4 end as ord,
            case when n = 1 then 'Abriram 1 vez' when n <= 5 then 'De 2 a 5 vezes' when n <= 20 then 'De 6 a 20 vezes' else 'Mais de 20 vezes' end as label
          from (select install_id, sum(opens) as n from app_days group by 1) per_install) buckets
        group by 1, 2) f), '[]'::jsonb)
  ) into v_stats;
  return v_stats;
end $$;
