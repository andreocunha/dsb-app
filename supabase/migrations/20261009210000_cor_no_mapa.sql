-- Cor de cada barco no mapa do rastreio, separada de teams.color (selo da equipe no app,
-- limitado a seis cores). Hex escolhido no /admin do rastreio; nula usa a cor do app.
alter table public.teams
  add column if not exists map_color text check (map_color ~ '^#[0-9a-f]{6}$');

-- Cores iniciais: uma por barco, puxadas da logo quando possível e sem repetir.
update public.teams as t set map_color = c.hex
from (values
  ('gune', '#ff4d4f'),            -- vermelho: lua crescente
  ('hefesto', '#ff7a1f'),         -- laranja
  ('solares', '#ffd60a'),         -- amarelo: sol
  ('solaris', '#2fbf5a'),         -- verde
  ('arariboia', '#1fc7b6'),       -- turquesa: serpente
  ('leviata', '#3a78ff'),         -- azul
  ('zenite', '#45b6ff'),          -- azul-céu: painel e água
  ('sete-capitaes', '#9b6bff'),   -- roxo
  ('fernando-amorim', '#c8894a'), -- bronze: faixa dourada
  ('solmar-celeris', '#e3e8ec'),  -- prata: letreiro branco no preto
  ('hurakan', '#a6e22e'),         -- verde-limão
  ('reis-do-sol', '#e14bd8')      -- magenta
) as c(id, hex)
where t.id = c.id and t.map_color is null;
