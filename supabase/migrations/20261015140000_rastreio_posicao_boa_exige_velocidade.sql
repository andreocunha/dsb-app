-- Posição por antena ou Wi-Fi às vezes chega dizendo ter 25 a 50 m de erro e passava pela trava de
-- 20261015133000. GPS de verdade sempre manda velocidade; a da rede nunca. Posição boa passa a ser:
-- erro de até 50 m e com velocidade (ou sem campo de precisão, como a da caixinha LoRa).
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
    and (excluded.accuracy_cm is null or (excluded.accuracy_cm <= 5000 and excluded.speed_cm_s is not null)
      or excluded.session_id <> public.tracker_latest.session_id
      or not (public.tracker_latest.accuracy_cm is null
        or (public.tracker_latest.accuracy_cm <= 5000 and public.tracker_latest.speed_cm_s is not null)));
  return new;
end $$;

revoke all on function public.tracker_capture_latest() from public,anon,authenticated;

commit;
