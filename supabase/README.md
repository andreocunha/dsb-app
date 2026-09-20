# Banco (Supabase)

Tudo do banco mora em `supabase/migrations/`: tabelas, RLS, RPCs, storage e realtime.

```bash
npm run db:link          # uma vez por máquina (pede a senha do banco)
npm run db:new nome      # cria supabase/migrations/<data>_nome.sql
npm run db:push          # aplica no Supabase só as migrations que ainda não rodaram
npm run db:status        # mostra o que já foi aplicado
```

Regras do projeto:
- Leitura pública (home, resultados, chat) sem login; escrita só por RPC `security definer`, que valida `auth.uid()`.
- Não edite uma migration já aplicada: crie outra com a mudança.
- Barcos (`teams`), provas (`races`) e pontos (`race_results`) são editados no Table Editor do painel.
