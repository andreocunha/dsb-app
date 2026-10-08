-- Convite por link nos grupos, como no WhatsApp: o admin gera um link, quem recebe vê o grupo
-- (foto, nome, descrição e quantas pessoas) e entra sozinho. Redefinir o link invalida o anterior.
-- Quem foi removido por um admin não volta pelo link: só um admin pode adicionar de novo.

-- Fica fora de conversations (que todo participante lê, inclusive pelo Realtime): só os admins veem o link,
-- e só pelas funções abaixo.
create table public.group_invites (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.group_invites enable row level security;
revoke all on public.group_invites from anon, authenticated;

alter table public.conversation_members
  add column removed boolean not null default false;

-- Aviso "Fulano entrou usando o link de convite".
alter table public.messages drop constraint messages_event_check;
alter table public.messages add constraint messages_event_check
  check (event is null or event->>'type' in ('created', 'added', 'removed', 'left', 'renamed', 'description', 'photo', 'joined'));

-- 22 letras e números seguros para link (128 bits aleatórios), no formato dos códigos do WhatsApp.
create function public.new_invite_code() returns text
language sql volatile set search_path = '' as $$
  select left(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), 22);
$$;
revoke execute on function public.new_invite_code() from public, anon, authenticated;

-- Link do grupo (só admins): devolve o atual, criando na primeira vez. p_reset troca por um novo.
create function public.group_invite(p_conversation uuid, p_reset boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem convidar por link.' using errcode = '42501'; end if;
  select code into v_code from public.group_invites where conversation_id = p_conversation;
  if v_code is null or p_reset then
    v_code := public.new_invite_code();
    insert into public.group_invites (conversation_id, code, created_by) values (p_conversation, v_code, auth.uid())
    on conflict (conversation_id) do update set code = excluded.code, created_by = excluded.created_by, created_at = now();
  end if;
  return v_code;
end $$;

-- O que o link mostra antes de entrar. Link inválido ou redefinido não devolve nada.
create function public.group_invite_info(p_code text)
returns table (id uuid, name text, description text, photo_path text, members int, joined boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.description, c.photo_path,
    (select count(*)::int from public.conversation_members m where m.conversation_id = c.id and m.left_at is null),
    public.is_participant(c.id)
  from public.group_invites i join public.conversations c on c.id = i.conversation_id
  where i.code = p_code;
$$;

-- Entrar pelo link. Já participa: só devolve o grupo. Como quem é adicionado, não vê o que foi falado antes.
create function public.join_group_by_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_since bigint;
begin
  if v_uid is null then raise exception 'Entre na sua conta para entrar no grupo.' using errcode = '28000'; end if;
  if (select banned_at from public.profiles where id = v_uid) is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  select conversation_id into v_id from public.group_invites where code = p_code;
  if v_id is null then raise exception 'Este link de convite não é válido. Ele pode ter sido redefinido por um admin do grupo.'; end if;
  if public.is_participant(v_id) then return v_id; end if;
  if exists (select 1 from public.conversation_members where conversation_id = v_id and user_id = v_uid and removed) then
    raise exception 'Você foi removido deste grupo. Só um admin pode adicionar você de novo.' using errcode = '42501';
  end if;
  if (select count(*) from public.conversation_members where conversation_id = v_id and left_at is null) >= 256 then
    raise exception 'Este grupo já está cheio: um grupo pode ter até 256 participantes.';
  end if;
  select coalesce(max(id), 0) into v_since from public.messages;
  insert into public.conversation_members (conversation_id, user_id, added_by, since_id)
  values (v_id, v_uid, null, v_since)
  on conflict (conversation_id, user_id) do update
    set left_at = null, admin = false, added_by = null, joined_at = now(), since_id = excluded.since_id;
  perform public.group_event(v_id, 'joined');
  return v_id;
end $$;

-- A foto do grupo aparece no convite para quem ainda não participa (só a foto atual de grupo com link).
create function public.is_invite_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_invites i join public.conversations c on c.id = i.conversation_id where c.photo_path = p_name);
$$;
revoke execute on function public.is_invite_photo(text) from public, anon;
grant execute on function public.is_invite_photo(text) to authenticated;
create policy dm_invite_photo on storage.objects for select to authenticated
  using (bucket_id = 'dm' and public.is_invite_photo(name));

-- Removido por um admin fica marcado (não volta pelo link); adicionado de novo, a marca sai.
create or replace function public.remove_group_member(p_conversation uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem remover participantes.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Para sair, use "Sair do grupo".'; end if;
  update public.conversation_members set left_at = now(), admin = false, removed = true
  where conversation_id = p_conversation and user_id = p_user and left_at is null;
  if not found then raise exception 'Essa pessoa não está no grupo.'; end if;
  perform public.group_event(p_conversation, 'removed', array[p_user]);
end $$;

create or replace function public.add_group_members(p_conversation uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_users uuid[];
  v_since bigint;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  if not public.is_group_admin(p_conversation) then raise exception 'Só admins do grupo podem adicionar participantes.' using errcode = '42501'; end if;
  select coalesce(array_agg(u), '{}') into v_users from unnest(public.addable_people(p_users[1:300])) u
  where not exists (select 1 from public.conversation_members m where m.conversation_id = p_conversation and m.user_id = u and m.left_at is null);
  if cardinality(v_users) = 0 then raise exception 'Ninguém para adicionar: essas pessoas já estão no grupo ou não podem entrar.'; end if;
  if (select count(*) from public.conversation_members where conversation_id = p_conversation and left_at is null) + cardinality(v_users) > 256 then
    raise exception 'Um grupo pode ter até 256 participantes.';
  end if;
  select coalesce(max(id), 0) into v_since from public.messages;
  insert into public.conversation_members (conversation_id, user_id, added_by, since_id)
  select p_conversation, u, v_uid, v_since from unnest(v_users) u
  on conflict (conversation_id, user_id) do update
    set left_at = null, admin = false, removed = false, added_by = excluded.added_by, joined_at = now(), since_id = excluded.since_id;
  perform public.group_event(p_conversation, 'added', v_users);
  return cardinality(v_users);
end $$;

revoke execute on function public.group_invite(uuid, boolean), public.join_group_by_invite(text) from public, anon;
grant execute on function public.group_invite(uuid, boolean), public.join_group_by_invite(text) to authenticated;
-- O convite aparece mesmo para quem ainda não entrou na conta (o botão pede o login).
revoke execute on function public.group_invite_info(text) from public;
grant execute on function public.group_invite_info(text) to anon, authenticated;
