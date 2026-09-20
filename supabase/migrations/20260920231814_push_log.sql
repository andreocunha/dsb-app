-- Registro dos avisos já enviados, para o agendamento não repetir a mesma notificação.
create table public.push_log (
  chave text primary key,
  titulo text not null,
  sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
-- Sem policies: só a função de envio (service role) escreve aqui.
