-- Notificação de mensagem nova, como no WhatsApp: cada mensagem com destinatário certo
-- (conversa particular, ou resposta a alguém no grupo) chama a Edge Function send-push.
-- O grupo inteiro não recebe push de toda mensagem: seria barulho demais para a torcida toda.
--
-- O net.http_post só entra na fila; quem chama a função é o worker do pg_net depois do commit.
-- Ou seja: não atrasa o envio da mensagem, e mensagem que falhou não gera notificação.
create function public.avisar_mensagem_nova() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_segredo text;
begin
  if new.conversation_id is null and new.reply_to is null then return new; end if;
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
revoke execute on function public.avisar_mensagem_nova() from public, anon, authenticated;

create trigger messages_push after insert on public.messages
  for each row execute function public.avisar_mensagem_nova();
