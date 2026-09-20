-- Agendamento dos avisos das provas: o banco chama a Edge Function a cada 5 minutos.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- O segredo fica no Vault; ninguém precisa escrevê-lo no código nem no agendamento.
create or replace function public.enviar_avisos_das_provas() returns void
language plpgsql security definer set search_path = '' as $$
declare v_segredo text;
begin
  select decrypted_secret into v_segredo from vault.decrypted_secrets where name = 'cron_secret';
  if v_segredo is null then
    raise warning 'Avisos não enviados: crie o segredo cron_secret no Vault.';
    return;
  end if;
  perform extensions.http_post(
    url := 'https://ztzmvdmggxyokfbakajq.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_segredo),
    body := '{"modo":"provas"}'::jsonb
  );
end $$;
revoke execute on function public.enviar_avisos_das_provas() from public, anon, authenticated;

select cron.schedule('avisos-das-provas', '*/5 * * * *', 'select public.enviar_avisos_das_provas()');
