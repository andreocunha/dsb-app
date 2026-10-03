-- Voltar para a foto da conta (Google), a que o perfil ganha no primeiro login.
-- O link vem do próprio login (auth.users), nunca do app: ninguém aponta a foto para um endereço qualquer.
create function public.use_account_avatar() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_url text;
begin
  if v_uid is null then raise exception 'Entre na sua conta.' using errcode = '28000'; end if;
  select left(coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture'), 500) into v_url
    from auth.users u where u.id = v_uid;
  if v_url is null then raise exception 'Sua conta não tem foto para usar.'; end if;
  update public.profiles set avatar_url = v_url where id = v_uid;
  update public.messages set author_avatar = v_url where user_id = v_uid and author_avatar is distinct from v_url;
  return v_url;
end $$;

revoke execute on function public.use_account_avatar() from public, anon;
grant execute on function public.use_account_avatar() to authenticated;
