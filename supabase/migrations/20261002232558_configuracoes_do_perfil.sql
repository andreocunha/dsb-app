-- Configurações do perfil: foto própria, vínculo com o DSB e filtros de notificação.

-- =====================================================================
-- Vínculo com o DSB (público, como o nome e a foto)
-- =====================================================================
-- affiliation: 'team' (de uma equipe), 'organization' (organização do evento) ou 'visitor'.
-- Nulo = a pessoa ainda não escolheu. team_id e team_status só existem para quem é de equipe.
alter table public.profiles
  add column affiliation text check (affiliation in ('team', 'organization', 'visitor')),
  -- Equipe não é apagada, só desativada (ver equipes_2026): a referência segura o histórico.
  add column team_id text references public.teams(id),
  add column team_status text check (team_status in ('member', 'alumni')),
  add constraint profiles_team_consistente check (case when affiliation = 'team'
    then team_id is not null and team_status is not null
    else team_id is null and team_status is null end);
create index profiles_team_idx on public.profiles(team_id) where team_id is not null;

create function public.update_affiliation(p_affiliation text, p_team_id text default null, p_team_status text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if p_affiliation not in ('team', 'organization', 'visitor') then raise exception 'Escolha como você participa do DSB.'; end if;
  if p_affiliation = 'team' then
    if p_team_status not in ('member', 'alumni') then raise exception 'Diga se você é membro ou ex-membro da equipe.'; end if;
    if not exists (select 1 from public.teams t where t.id = p_team_id) then raise exception 'Equipe não encontrada.'; end if;
    -- Equipe fora desta edição só vale para quem já passou por ela.
    if p_team_status = 'member' and not exists (select 1 from public.teams t where t.id = p_team_id and t.active) then
      raise exception 'Essa equipe não está nesta edição. Marque como ex-membro.';
    end if;
  end if;
  update public.profiles
     set affiliation = p_affiliation,
         team_id = case when p_affiliation = 'team' then p_team_id end,
         team_status = case when p_affiliation = 'team' then p_team_status end
   where id = v_uid;
end $$;

-- =====================================================================
-- Foto do perfil (bucket público: a foto aparece no chat e no ranking)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create policy avatars_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy avatars_read_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- p_path: arquivo já enviado para "avatars/<pessoa>/...". Nulo tira a foto (ficam as iniciais).
-- As mensagens guardam a foto de quem escreveu, então trocam junto (como o nome em update_profile).
create function public.update_avatar(p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_url text;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if p_path is not null and (
    p_path not like v_uid::text || '/%'
    or not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path and o.metadata->>'mimetype' like 'image/%')
  ) then raise exception 'Foto inválida. Tente enviar de novo.'; end if;
  v_url := case when p_path is not null then 'https://ztzmvdmggxyokfbakajq.supabase.co/storage/v1/object/public/avatars/' || p_path end;
  update public.profiles set avatar_url = v_url where id = v_uid;
  update public.messages set author_avatar = v_url where user_id = v_uid and author_avatar is distinct from v_url;
  return v_url;
end $$;

-- =====================================================================
-- Filtros de notificação (privados: só a própria pessoa e a send-push leem)
-- =====================================================================
-- chat: 'all' = toda mensagem, inclusive da Torcida Solar; 'mentions' = conversas e grupos normalmente,
-- e na Torcida Solar só menções e respostas (o padrão); 'off' = nada do chat.
-- Sem linha = padrão (tudo ligado, chat em 'mentions'), inclusive para aparelhos sem conta.
create table public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat text not null default 'mentions' check (chat in ('all', 'mentions', 'off')),
  fantasy boolean not null default true,
  announcements boolean not null default true,
  updated_at timestamptz not null default now()
);
-- O gatilho do chat pergunta "alguém quer tudo da Torcida Solar?" a cada mensagem.
create index notification_prefs_chat_all_idx on public.notification_prefs(user_id) where chat = 'all';
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.notification_prefs to authenticated;

create function public.update_notification_prefs(p_chat text, p_fantasy boolean, p_announcements boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if p_chat not in ('all', 'mentions', 'off') then raise exception 'Opção de notificação inválida.'; end if;
  insert into public.notification_prefs (user_id, chat, fantasy, announcements)
  values (v_uid, p_chat, coalesce(p_fantasy, true), coalesce(p_announcements, true))
  on conflict (user_id) do update
    set chat = excluded.chat, fantasy = excluded.fantasy, announcements = excluded.announcements, updated_at = now();
end $$;

-- Notificação: mensagem comum da Torcida Solar agora também chama a send-push
-- quando alguém escolheu receber tudo do chat.
create or replace function public.avisar_mensagem_nova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_segredo text;
begin
  if new.conversation_id is null and new.reply_to is null and cardinality(new.mentions) = 0 and not new.mention_all
     and not exists (select 1 from public.notification_prefs p where p.chat = 'all' and p.user_id <> new.user_id) then
    return new;
  end if;
  if new.event is not null and new.event->>'type' not in ('created', 'added') then return new; end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cron_secret';
  if v_segredo is null then
    raise warning 'Notificação não enviada: crie o segredo cron_secret no Vault.';
    return new;
  end if;
  perform net.http_post(
    url := 'https://ztzmvdmggxyokfbakajq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_segredo),
    body := jsonb_build_object('modo', 'mensagem', 'id', new.id)
  );
  return new;
exception when others then
  -- Problema na notificação nunca pode impedir a mensagem de ser enviada.
  raise warning 'Notificação não enviada: %', sqlerrm;
  return new;
end $$;

revoke execute on function public.update_affiliation(text, text, text), public.update_avatar(text),
  public.update_notification_prefs(text, boolean, boolean) from public, anon;
grant execute on function public.update_affiliation(text, text, text), public.update_avatar(text),
  public.update_notification_prefs(text, boolean, boolean) to authenticated;
