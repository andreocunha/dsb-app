-- Histórico dos aparelhos: a contagem por aparelho começou em 12/10/2026, mas o login no app deixa
-- rastro desde antes. Cada sessão do Supabase Auth guarda o aparelho (user agent) e cada renovação
-- dela marca um momento de uso. Daqui sai, para quem entrou na conta pelo app das lojas, em que dia
-- o aparelho apareceu e em que dias foi usado.
--
-- É estimativa, e fica marcada como tal (estimated): não inclui quem usou sem entrar na conta nem
-- quem saiu da conta (a sessão some), e as aberturas são as renovações da sessão, não visitas contadas.

alter table public.app_installs add column estimated boolean not null default false;
alter table public.app_install_days add column estimated boolean not null default false;

-- Sessões abertas dentro do app das lojas: WebView no Android, e no iPhone o user agent sem "Safari/".
-- O modelo e o sistema saem no mesmo formato de lib/device.ts, para casar com o que o aparelho envia.
create temp table hist_events on commit drop as
with app_sessions as (
  select s.id, s.user_id, s.created_at,
    case when s.user_agent ~ 'Android' and s.user_agent ~ '; wv\)' then 'android'
         when s.user_agent ~ '\((iPhone|iPad|iPod)' and s.user_agent !~ 'Safari/' then 'ios' end as platform,
    coalesce(trim(substring(s.user_agent from 'Android [0-9.]+; (.+?) Build/')), substring(s.user_agent from '\((iPhone|iPad|iPod)')) as model,
    case when s.user_agent ~ 'Android' then 'Android ' || substring(s.user_agent from 'Android ([0-9.]+)')
         else 'iOS ' || replace(substring(s.user_agent from ' OS ([0-9_]+)'), '_', '.') end as os
  from auth.sessions s
)
select s.user_id, s.platform, s.model, s.os, e.at
from app_sessions s
cross join lateral (
  select r.created_at as at from auth.refresh_tokens r where r.session_id = s.id
  union all
  select s.created_at where not exists (select 1 from auth.refresh_tokens r where r.session_id = s.id)
) e
where s.platform is not null;

-- Um aparelho é a conta + a plataforma + o modelo. Quem já está na contagem nova (mesma conta e mesmo
-- aparelho) só ganha os dias anteriores; os outros entram como estimados até abrirem o app de novo.
create temp table hist_devices on commit drop as
select d.*, coalesce(d.matched_id, gen_random_uuid()) as install_id
from (
  select e.user_id, e.platform, e.model, (array_agg(e.os order by e.at desc))[1] as os, min(e.at) as first_at, max(e.at) as last_at,
    (select i.id from public.app_installs i
      where i.user_id = e.user_id and i.platform = e.platform and i.device_model is not distinct from e.model
      order by i.first_seen_at limit 1) as matched_id
  from hist_events e group by e.user_id, e.platform, e.model
) d;

insert into public.app_installs (id, platform, device_model, os, push_status, user_id, first_login_at, first_seen_at, last_seen_at, estimated)
select d.install_id, d.platform, left(d.model, 80), left(d.os, 40),
  -- Quem tem aparelho registrado para push nesta plataforma aceitou as notificações.
  case when exists (select 1 from public.push_devices p where p.user_id = d.user_id and p.platform = d.platform) then 'granted' end,
  d.user_id, d.first_at, d.first_at, d.last_at, true
from hist_devices d where d.matched_id is null;

-- O dia que a contagem nova já tem fica como está.
insert into public.app_install_days (install_id, day, opens, estimated)
select d.install_id, (e.at at time zone 'America/Sao_Paulo')::date, count(*), true
from hist_events e
join hist_devices d on d.user_id = e.user_id and d.platform = e.platform and d.model is not distinct from e.model
group by 1, 2
on conflict (install_id, day) do nothing;

create or replace function public.track_install(
  p_id uuid, p_platform text, p_model text default null, p_os text default null,
  p_app_version text default null, p_push text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_model text := left(nullif(trim(p_model), ''), 80);
  v_last timestamptz;
  v_previous_user uuid;
  v_estimated uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_id is null then return; end if;
  -- A linha fica travada até o fim: duas chamadas da mesma abertura não contam em dobro.
  select last_seen_at, user_id into v_last, v_previous_user from public.app_installs where id = p_id for update;
  insert into public.app_installs as i (id, platform, device_model, os, app_version, push_status, user_id, first_login_at)
  values (
    p_id, p_platform, v_model, left(nullif(trim(p_os), ''), 40),
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
  -- Primeira vez que este aparelho aparece com conta: se ele já estava no histórico estimado
  -- (mesma conta e plataforma, de preferência o mesmo modelo), herda os dias e o estimado sai.
  if v_user is not null and v_previous_user is null then
    select e.id into v_estimated from public.app_installs e
    where e.estimated and e.user_id = v_user and e.platform = p_platform and e.id <> p_id
    order by (e.device_model is not distinct from v_model) desc, e.last_seen_at desc
    limit 1 for update;
    if v_estimated is not null then
      insert into public.app_install_days (install_id, day, opens, estimated)
      select p_id, h.day, h.opens, true from public.app_install_days h where h.install_id = v_estimated
      on conflict (install_id, day) do nothing;
      delete from public.app_installs where id = v_estimated;
    end if;
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
    -- Desde quando a contagem é por aparelho; antes disso só existe o histórico estimado pelos logins.
    'since', (select min(first_seen_at) from public.app_installs where not estimated),
    'estimated_devices', (select count(*) from app where estimated),
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
    -- A versão só é conhecida de quem abriu o app depois que a contagem começou.
    'versions', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'total', total) order by total desc, label)
      from (select case platform when 'ios' then 'iOS' else 'Android' end || ' ' || app_version as label, count(*) as total
        from app where app_version is not null group by 1) v), '[]'::jsonb),
    -- Últimos 14 dias: aparelhos que abriram o app em cada dia, quantos apareceram pela primeira vez e as aberturas.
    'days', coalesce((select jsonb_agg(jsonb_build_object('label', to_char(x.day, 'DD/MM'), 'total', x.total, 'new', x.new, 'opens', x.opens, 'estimated', x.estimated) order by x.day desc)
      from (select d.day, count(*) as total, count(*) filter (where d.day = f.first_day) as new, sum(d.opens) as opens, bool_or(d.estimated) as estimated
        from app_days d join (select install_id, min(day) as first_day from app_days group by 1) f on f.install_id = d.install_id
        where d.day > v_today - 14 group by 1) x), '[]'::jsonb),
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
