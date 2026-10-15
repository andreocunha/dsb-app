-- Mapa ao vivo: posição sem GPS (antena de celular, erro de 100 a 800 m) não substitui uma posição
-- boa da mesma viagem. Sem sinal de satélite o barco fica parado no último ponto bom, mostrando há
-- quanto tempo, em vez de pular entre antenas. O histórico (tracker_points) continua com tudo.
-- Uma viagem que ainda não teve posição boa mostra a imprecisa, para o barco não sumir do mapa.
begin;

create or replace function public.tracker_capture_latest() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.tracker_latest values(new.device_id,new.id,new.session_id,new.team_id,
    new.captured_at,new.received_at,new.lat_e7,new.lon_e7,new.accuracy_cm,new.speed_cm_s,new.bearing_deg)
  on conflict(device_id) do update set point_id=excluded.point_id,session_id=excluded.session_id,
    team_id=excluded.team_id,captured_at=excluded.captured_at,received_at=excluded.received_at,
    lat_e7=excluded.lat_e7,lon_e7=excluded.lon_e7,accuracy_cm=excluded.accuracy_cm,
    speed_cm_s=excluded.speed_cm_s,bearing_deg=excluded.bearing_deg
  where excluded.captured_at > public.tracker_latest.captured_at
    and (excluded.accuracy_cm is null or excluded.accuracy_cm <= 5000
      or excluded.session_id <> public.tracker_latest.session_id
      or coalesce(public.tracker_latest.accuracy_cm, 0) > 5000);
  return new;
end $$;

revoke all on function public.tracker_capture_latest() from public,anon,authenticated;

commit;
