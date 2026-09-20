-- DSB · schema inicial.
-- Leitura pública (home, resultados, chat) sem login; toda escrita passa por RPC
-- (security definer) que valida auth.uid() e as regras no próprio banco.

-- =====================================================================
-- Perfis
-- =====================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  created_at timestamptz not null default now()
);

-- Cria o perfil no primeiro login (Google, Apple ou e-mail).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    left(coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Torcedor'), 40),
    left(coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'), 500)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Provas, barcos e resultados (editados pelo painel do Supabase)
-- =====================================================================
create table public.teams (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  university text not null default '',
  initials text not null check (char_length(initials) between 1 and 3),
  color text not null default 'purple' check (color in ('green', 'gold', 'blue', 'orange', 'purple', 'cyan')),
  tier text not null check (tier in ('A', 'B', 'C')),
  active boolean not null default true
);

create table public.races (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  number smallint not null unique,
  name text not null,
  starts_at timestamptz not null
);

create table public.race_results (
  race_id text not null references public.races(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  points integer not null default 0,
  primary key (race_id, team_id)
);
create index race_results_team_idx on public.race_results(team_id);

-- Classificação geral da home.
create view public.team_standings with (security_invoker = true) as
  select t.id, t.name, t.university, t.initials, t.color, t.tier,
         coalesce(sum(r.points), 0)::int as points
  from public.teams t
  left join public.race_results r on r.team_id = t.id
  where t.active
  group by t.id;

-- =====================================================================
-- Fantasy: uma escalação por pessoa e prova, vagas [A, B, B, C]
-- =====================================================================
create table public.fantasy_lineups (
  user_id uuid not null references auth.users(id) on delete cascade,
  race_id text not null references public.races(id) on delete cascade,
  team_ids text[] not null check (cardinality(team_ids) = 4),
  updated_at timestamptz not null default now(),
  primary key (user_id, race_id)
);
create index fantasy_lineups_race_idx on public.fantasy_lineups(race_id);

create function public.save_lineup(p_race_id text, p_team_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_slots constant text[] := array['A', 'B', 'B', 'C'];
  v_tier text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para escalar.' using errcode = '28000'; end if;
  select starts_at into v_start from public.races where id = p_race_id;
  if v_start is null then raise exception 'Prova não encontrada.'; end if;
  if v_start <= now() then raise exception 'A escalação desta prova já fechou.'; end if;
  if cardinality(p_team_ids) is distinct from 4 then raise exception 'Escalação inválida.'; end if;
  for i in 1..4 loop
    if p_team_ids[i] is not null then
      select tier into v_tier from public.teams where id = p_team_ids[i] and active;
      if v_tier is distinct from v_slots[i] then raise exception 'Barco inválido para esta vaga.'; end if;
    end if;
  end loop;
  if p_team_ids[2] = p_team_ids[3] then raise exception 'Escolha dois barcos diferentes no tier B.'; end if;

  if array_remove(p_team_ids, null) = '{}' then
    delete from public.fantasy_lineups where user_id = v_uid and race_id = p_race_id;
  else
    insert into public.fantasy_lineups (user_id, race_id, team_ids) values (v_uid, p_race_id, p_team_ids)
    on conflict (user_id, race_id) do update set team_ids = excluded.team_ids, updated_at = now();
  end if;
end $$;

-- Repete a escalação de uma prova em todas as seguintes que ainda não largaram.
create function public.copy_lineup_forward(p_race_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ids text[];
begin
  if v_uid is null then raise exception 'Entre na sua conta para escalar.' using errcode = '28000'; end if;
  select team_ids into v_ids from public.fantasy_lineups where user_id = v_uid and race_id = p_race_id;
  if v_ids is null then raise exception 'Monte esta escalação primeiro.'; end if;
  insert into public.fantasy_lineups (user_id, race_id, team_ids)
  select v_uid, r.id, v_ids from public.races r
  where r.number > (select number from public.races where id = p_race_id) and r.starts_at > now()
  on conflict (user_id, race_id) do update set team_ids = excluded.team_ids, updated_at = now();
end $$;

-- Ranking geral: soma dos pontos dos barcos escalados em cada prova.
create function public.fantasy_ranking(p_limit int default 100)
returns table (user_id uuid, name text, avatar_url text, points int, "position" bigint)
language sql stable security definer set search_path = '' as $$
  with scores as (
    select l.user_id, coalesce(sum(r.points), 0)::int as points
    from public.fantasy_lineups l
    cross join lateral unnest(l.team_ids) as t(team_id)
    left join public.race_results r on r.race_id = l.race_id and r.team_id = t.team_id
    group by l.user_id
  ), ranked as (
    select s.user_id, p.name, p.avatar_url, s.points, rank() over (order by s.points desc) as "position"
    from scores s join public.profiles p on p.id = s.user_id
  )
  select * from ranked
  where "position" <= least(greatest(p_limit, 1), 500) or ranked.user_id = auth.uid()
  order by "position", name;
$$;

-- =====================================================================
-- Chat
-- =====================================================================
create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  author_avatar text,
  body text check (body is null or char_length(body) between 1 and 2000),
  file_path text,
  file_name text,
  file_type text,
  file_size bigint,
  thumb_path text,
  width int,
  height int,
  created_at timestamptz not null default now(),
  check (body is not null or file_path is not null)
);
create index messages_user_idx on public.messages(user_id, created_at desc);

-- Uma reação por pessoa em cada mensagem, como no WhatsApp.
create table public.message_reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_reactions_user_idx on public.message_reactions(user_id);

create table public.message_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);
create index message_reports_reporter_idx on public.message_reports(reporter_id);

create table public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id);

-- Página do chat (mais recentes primeiro) já com as reações agregadas.
create function public.chat_messages(p_before bigint default null, p_limit int default 50)
returns table (
  id bigint, user_id uuid, author_name text, author_avatar text, body text,
  file_path text, file_name text, file_type text, file_size bigint, thumb_path text,
  width int, height int, created_at timestamptz, reactions jsonb
)
language sql stable set search_path = '' as $$
  select m.id, m.user_id, m.author_name, m.author_avatar, m.body,
         m.file_path, m.file_name, m.file_type, m.file_size, m.thumb_path,
         m.width, m.height, m.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
                   from public.message_reactions r where r.message_id = m.id), '[]'::jsonb)
  from public.messages m
  where p_before is null or m.id < p_before
  order by m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.send_message(
  p_body text default null,
  p_file_path text default null,
  p_thumb_path text default null,
  p_file_name text default null,
  p_width int default null,
  p_height int default null
) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(p_body), '');
  v_type text;
  v_size bigint;
  v_profile public.profiles;
  v_message public.messages;
begin
  if v_uid is null then raise exception 'Entre na sua conta para enviar mensagens.' using errcode = '28000'; end if;
  if (select count(*) from public.messages where user_id = v_uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Calma! Você está enviando mensagens rápido demais.';
  end if;
  if v_body is null and p_file_path is null then raise exception 'Mensagem vazia.'; end if;

  -- Os arquivos precisam existir no storage, dentro da pasta da própria pessoa.
  if p_file_path is not null then
    if split_part(p_file_path, '/', 1) <> v_uid::text then raise exception 'Arquivo inválido.'; end if;
    select o.metadata->>'mimetype', (o.metadata->>'size')::bigint into v_type, v_size
    from storage.objects o where o.bucket_id = 'chat' and o.name = p_file_path;
    if not found then raise exception 'Arquivo não encontrado. Tente enviar de novo.'; end if;
  end if;
  if p_thumb_path is not null and (
    split_part(p_thumb_path, '/', 1) <> v_uid::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'chat' and o.name = p_thumb_path)
  ) then raise exception 'Miniatura inválida.'; end if;

  select * into v_profile from public.profiles where id = v_uid;
  insert into public.messages (user_id, author_name, author_avatar, body, file_path, file_name, file_type, file_size, thumb_path, width, height)
  values (
    v_uid, v_profile.name, v_profile.avatar_url, v_body, p_file_path,
    case when p_file_path is not null then left(coalesce(nullif(btrim(p_file_name), ''), 'arquivo'), 200) end,
    v_type, v_size, p_thumb_path,
    case when p_width between 1 and 20000 then p_width end,
    case when p_height between 1 and 20000 then p_height end
  )
  returning * into v_message;
  return v_message;
end $$;

-- Apaga a própria mensagem e devolve os arquivos para o app remover do storage.
create function public.delete_message(p_id bigint) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_paths text[];
begin
  delete from public.messages where id = p_id and user_id = auth.uid()
  returning array_remove(array[file_path, thumb_path], null) into v_paths;
  if v_paths is null then raise exception 'Mensagem não encontrada.'; end if;
  return v_paths;
end $$;

-- Emoji nulo remove a reação.
create function public.react_to_message(p_message_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta para reagir.' using errcode = '28000'; end if;
  if p_emoji is null then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_uid;
  else
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message_id, v_uid, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

-- Quem reagiu a uma mensagem.
create function public.message_reactors(p_message_id bigint)
returns table (user_id uuid, name text, avatar_url text, emoji text)
language sql stable set search_path = '' as $$
  select r.user_id, p.name, p.avatar_url, r.emoji
  from public.message_reactions r join public.profiles p on p.id = r.user_id
  where r.message_id = p_message_id
  order by r.created_at;
$$;

create function public.report_message(p_message_id bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para denunciar.' using errcode = '28000'; end if;
  insert into public.message_reports (message_id, reporter_id, reason)
  values (p_message_id, auth.uid(), left(nullif(btrim(p_reason), ''), 500))
  on conflict (message_id, reporter_id) do nothing;
end $$;

-- =====================================================================
-- Conta
-- =====================================================================
create function public.update_profile(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_name);
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'Use um nome entre 1 e 40 caracteres.'; end if;
  update public.profiles set name = v_name where id = v_uid;
  update public.messages set author_name = v_name where user_id = v_uid;
end $$;

-- Exclusão de conta exigida pelas lojas: apaga o usuário e tudo que depende dele.
create function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- =====================================================================
-- Push (app das lojas via Capacitor)
-- =====================================================================
create table public.push_devices (
  token text primary key check (char_length(token) between 10 and 4096),
  platform text not null check (platform in ('ios', 'android')),
  user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index push_devices_user_idx on public.push_devices(user_id);

-- Qualquer instalação pode registrar o aparelho, com ou sem login.
create function public.register_push_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_devices (token, platform, user_id) values (p_token, p_platform, auth.uid())
  on conflict (token) do update set platform = excluded.platform, user_id = excluded.user_id, updated_at = now();
end $$;

-- =====================================================================
-- Storage: mídias do chat (bucket público, cada pessoa só escreve na sua pasta)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', true, 52428800) -- 50MB: máximo do plano gratuito
on conflict (id) do nothing;

create policy chat_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy chat_read_own on storage.objects for select to authenticated
  using (bucket_id = 'chat' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy chat_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- =====================================================================
-- RLS, permissões e realtime
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.races enable row level security;
alter table public.race_results enable row level security;
alter table public.fantasy_lineups enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.push_devices enable row level security;

create policy profiles_read on public.profiles for select to anon, authenticated using (true);
create policy teams_read on public.teams for select to anon, authenticated using (true);
create policy races_read on public.races for select to anon, authenticated using (true);
create policy race_results_read on public.race_results for select to anon, authenticated using (true);
create policy messages_read on public.messages for select to anon, authenticated using (true);
create policy reactions_read on public.message_reactions for select to anon, authenticated using (true);
create policy lineups_read_own on public.fantasy_lineups for select to authenticated
  using (user_id = (select auth.uid()));
create policy blocks_own on public.user_blocks for all to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

-- Só o necessário: leitura direta e bloqueios; o resto é via RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.teams, public.races, public.race_results, public.team_standings,
  public.messages, public.message_reactions to anon, authenticated;
grant select on public.fantasy_lineups to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.chat_messages(bigint, int), public.message_reactors(bigint),
  public.fantasy_ranking(int), public.register_push_device(text, text) to anon, authenticated;
grant execute on function public.save_lineup(text, text[]), public.copy_lineup_forward(text),
  public.send_message(text, text, text, text, int, int), public.delete_message(bigint),
  public.react_to_message(bigint, text), public.report_message(bigint, text),
  public.update_profile(text), public.delete_account() to authenticated;

alter publication supabase_realtime add table public.messages, public.message_reactions;
