-- Exigências da diretriz 1.2 da App Store para apps com conteúdo de usuário:
-- aceite dos termos, filtro automático de conteúdo ofensivo e banimento de quem publica.

alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column banned_at timestamptz,
  add column banned_by uuid references auth.users(id);

-- Registra o aceite feito na tela de login, que acontece antes de existir sessão.
create function public.accept_terms(p_accepted_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  update public.profiles
     set terms_accepted_at = least(coalesce(p_accepted_at, now()), now())
   where id = v_uid and terms_accepted_at is null;
end $$;

-- Normaliza para o filtro: sem acento, sem maiúscula, sem letra repetida e sem pontuação
-- ("CARALHO", "caraaalho" e "caralho!" viram a mesma coisa).
create function public.normalize_for_filter(p_texto text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_texto, '')),
                       'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
             '(.)\1+', '\1', 'g'),
           '[^a-z0-9]+', ' ', 'g');
$$;

-- A organização ajusta a lista com insert/delete, sem precisar de deploy.
create table public.banned_terms (
  term text primary key,
  created_at timestamptz not null default now()
);
alter table public.banned_terms enable row level security;
-- Ninguém lê pelo app: a lista só é consultada de dentro das funções.
revoke all on table public.banned_terms from anon, authenticated;

insert into public.banned_terms (term)
select public.normalize_for_filter(t) from unnest(array[
  -- Palavrões e ofensas pessoais.
  'caralho', 'porra', 'merda', 'buceta', 'cuzao', 'foda', 'foder', 'fodase',
  'puta', 'putaqueopariu', 'vagabunda', 'vadia', 'piranha', 'corno', 'otario',
  'imbecil', 'babaca', 'arrombado', 'desgracado', 'filhodaputa', 'fdp', 'escroto',
  -- Discurso de ódio.
  'viado', 'bicha', 'traveco', 'sapatao', 'crioulo', 'nazista', 'retardado'
]) as t
on conflict (term) do nothing;

create function public.has_banned_term(p_texto text) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.banned_terms b
    where public.normalize_for_filter(p_texto) ~ ('\m' || b.term || '\M')
  );
$$;

-- Bane a conta e apaga o que ela escreveu. Só moderador, e nunca a si mesmo.
create function public.ban_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'moderator') then
    raise exception 'Só a organização pode banir.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then raise exception 'Você não pode banir a si mesmo.'; end if;
  update public.profiles set banned_at = now(), banned_by = v_uid where id = p_user_id;
  update public.messages
     set deleted_at = now(), deleted_by = v_uid, body = null,
         file_path = null, thumb_path = null, file_name = null, file_type = null
   where user_id = p_user_id and deleted_at is null;
end $$;

-- send_message ganha as duas barreiras: conta banida e termo proibido.
create or replace function public.send_message(
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
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.banned_at is not null then
    raise exception 'Sua conta foi banida do chat por quebrar as regras de uso.' using errcode = '42501';
  end if;
  if (select count(*) from public.messages where user_id = v_uid and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Calma! Você está enviando mensagens rápido demais.';
  end if;
  if v_body is null and p_file_path is null then raise exception 'Mensagem vazia.'; end if;
  if v_body is not null and public.has_banned_term(v_body) then
    raise exception 'Sua mensagem tem uma palavra que o chat não aceita. O DSB não tolera ofensa nem discurso de ódio.';
  end if;

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

revoke execute on function public.normalize_for_filter(text), public.has_banned_term(text) from public, anon, authenticated;
revoke execute on function public.accept_terms(timestamptz), public.ban_user(uuid) from public, anon;
grant execute on function public.accept_terms(timestamptz), public.ban_user(uuid) to authenticated;
