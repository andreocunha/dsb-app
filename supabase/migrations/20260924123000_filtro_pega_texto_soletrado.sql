-- A normalização troca pontuação por espaço, então "c.a.r.a.l.h.o" escapava do filtro.
-- Três ou mais letras soltas seguidas não acontecem em texto de verdade: quando o padrão
-- aparece, vale juntar tudo e procurar o termo sem exigir limite de palavra.
create or replace function public.has_banned_term(p_texto text) returns boolean
language sql stable set search_path = '' as $$
  with formas as (select public.normalize_for_filter(p_texto) as texto),
  variantes as (
    select texto as forma, true as com_borda from formas
    union all
    select replace(texto, ' ', ''), false from formas where texto ~ '(\m[a-z] ){3,}'
  )
  select exists (
    select 1 from public.banned_terms b, variantes v
    where v.forma ~ (case when v.com_borda then '\m' || b.term || '\M' else b.term end)
  );
$$;

revoke execute on function public.has_banned_term(text) from public, anon, authenticated;
