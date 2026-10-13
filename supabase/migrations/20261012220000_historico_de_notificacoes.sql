-- Histórico de notificações: o sino da home lista os recados da organização e os avisos das provas.
-- Cada recado pode levar uma imagem ou um GIF, que aparece ao abrir a notificação no app
-- (e, no Android, também na própria notificação do sistema).
--
-- As mensagens do chat não entram aqui: elas já têm os contadores e a lista de conversas.
-- O que já foi lido fica no aparelho (como o último lido do grupo geral antes de entrar na conta).

create table public.notifications (
  id bigint generated always as identity primary key,
  -- announcement: recado da organização · race_start: largada · fantasy_reminder: 1 hora antes da prova
  kind text not null check (kind in ('announcement', 'race_start', 'fantasy_reminder')),
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 500),
  image_url text check (image_url is null or image_url ~ '^https://'),
  created_at timestamptz not null default now()
);
create index notifications_recent on public.notifications (created_at desc);
alter table public.notifications enable row level security;
-- Os mesmos avisos chegam para todo mundo (inclusive quem usa sem conta): leitura livre, escrita só pelo banco.
create policy notifications_read on public.notifications for select to anon, authenticated using (true);
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to anon, authenticated;
alter publication supabase_realtime add table public.notifications;

-- O que já foi enviado antes do sino existir: o push_log guarda só o título. Os textos das provas
-- são fixos (send-push), então voltam; o dos recados não foi guardado e fica só o título.
insert into public.notifications (kind, title, body, created_at)
select
  case when l.chave like 'aviso:%' then 'announcement' when l.chave like '%:1h' then 'fantasy_reminder' else 'race_start' end,
  l.titulo,
  case when l.chave like '%:1h' then coalesce(r.name || '. ', '') || 'Última chance de mudar seu fantasy.'
       when l.chave like '%:largada' then 'Acompanhe os barcos ao vivo no mapa.' end,
  l.sent_at
from public.push_log l
left join public.races r on l.chave like '%:1h' and r.id::text = split_part(l.chave, ':', 1)
order by l.sent_at;

-- ---------------------------------------------------------------------
-- Imagens e GIFs dos recados: bucket público, só a organização envia
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avisos', 'avisos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif']) -- 5 MB
on conflict (id) do nothing;

create policy avisos_upload_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'avisos' and public.is_admin());
create policy avisos_delete_admin on storage.objects for delete to authenticated
  using (bucket_id = 'avisos' and public.is_admin());

-- ---------------------------------------------------------------------
-- Recado da organização, agora com imagem opcional e no histórico
-- ---------------------------------------------------------------------
-- O recado entra no histórico na hora (quem está sem notificação no aparelho também vê pelo sino)
-- e a Edge Function manda o push com o id dele, para o toque abrir o recado no app.
-- titulo e texto continuam indo junto: a versão anterior da send-push só entende esses dois.
drop function public.send_announcement(text, text);
create function public.send_announcement(p_title text, p_body text, p_image_url text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_segredo text; v_id bigint;
  v_title text := trim(coalesce(p_title, '')); v_body text := trim(coalesce(p_body, ''));
  v_image text := nullif(trim(coalesce(p_image_url, '')), '');
begin
  perform public.require_admin();
  if char_length(v_title) not between 1 and 65 then raise exception 'O título precisa ter entre 1 e 65 caracteres.'; end if;
  if char_length(v_body) not between 1 and 240 then raise exception 'O texto precisa ter entre 1 e 240 caracteres.'; end if;
  if v_image is not null and v_image !~ '^https://' then raise exception 'Imagem inválida.'; end if;
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cron_secret';
  if v_segredo is null then raise exception 'Notificações não configuradas: crie o segredo cron_secret no Vault.'; end if;
  insert into public.notifications (kind, title, body, image_url)
  values ('announcement', v_title, v_body, v_image)
  returning id into v_id;
  perform net.http_post(
    url := 'https://ztzmvdmggxyokfbakajq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_segredo),
    body := jsonb_build_object('modo', 'aviso', 'titulo', v_title, 'texto', v_body, 'imagem', v_image, 'notificacao', v_id)
  );
  return v_id;
end $$;
revoke execute on function public.send_announcement(text, text, text) from public, anon;
grant execute on function public.send_announcement(text, text, text) to authenticated;
