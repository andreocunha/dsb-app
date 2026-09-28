-- Aparência dos barcos no mapa ao vivo (dsb-rastreio): forma do casco e motores de popa.
alter table public.teams
  add column if not exists boat_hull text not null default 'cat' check (boat_hull in ('cat', 'mono')),
  add column if not exists boat_motors smallint not null default 1 check (boat_motors between 1 and 3);
