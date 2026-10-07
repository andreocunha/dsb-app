-- Rastreio: o histórico é do barco, não do celular.
--
-- Trajetos, posições e SOS já guardam a equipe (team_id). Trocar o celular de um barco não muda
-- nada para o mapa nem para o histórico. Agora também dá para apagar um aparelho no painel da
-- organização do rastreio sem perder nada da equipe: só o vínculo com o aparelho apagado fica vazio.
-- (tracker_latest é só a última posição de cada aparelho; o painel apaga essa linha junto.)

alter table public.tracker_points alter column device_id drop not null;
alter table public.tracker_sessions alter column device_id drop not null;
alter table public.tracker_sos alter column device_id drop not null;

alter table public.tracker_points drop constraint tracker_points_device_id_fkey,
  add constraint tracker_points_device_id_fkey foreign key (device_id) references public.tracker_devices(id) on delete set null;
alter table public.tracker_sessions drop constraint tracker_sessions_device_id_fkey,
  add constraint tracker_sessions_device_id_fkey foreign key (device_id) references public.tracker_devices(id) on delete set null;
alter table public.tracker_sos drop constraint tracker_sos_device_id_fkey,
  add constraint tracker_sos_device_id_fkey foreign key (device_id) references public.tracker_devices(id) on delete set null;
