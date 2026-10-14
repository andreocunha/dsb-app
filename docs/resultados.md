# Lançar resultados

O jeito mais rápido é o **painel da organização** no próprio app (`/admin/`, ou Menu → Painel da organização): voltas com um toque, largada real, DNF/DNS, duelos do Match Race, documentação, artigo, penalidades, notificação para todos e o link da live. Ele aparece só para os e-mails cadastrados em `admin_emails`:

```sql
insert into public.admin_emails (email) values ('pessoa@exemplo.com');
```

Tudo abaixo também pode ser preenchido no Table Editor do Supabase. Os pontos são calculados sozinhos pela tabela do edital (item 10.2) e aparecem no app na hora, sem precisar publicar nada.

## Antes do evento

- **`races`**: preencha `duration_minutes` (tempo com o gate aberto) de cada prova. A prova com o maior valor desempata a classificação geral.
- **`teams`**: `docs_delivered` (itens de documentação entregues no prazo, de 0 a 7) e `article_delivered` (artigo científico). Cada item vale 20 pontos.

## Provas de voltas

- **`race_laps`**: uma linha por volta completada: `race_id`, `team_id` e `completed_at` (horário em que o barco fechou a volta). A colocação sai daqui: mais voltas vence e, no empate, ganha quem fechou a última volta primeiro.
- Se a largada atrasar, preencha `races.started_at` com o horário real, para o tempo da primeira volta sair certo.
- Volta lançada errada: apague a linha. As voltas são numeradas pela ordem dos horários.

## Match Race

A chave segue a Instrução Técnica de 2026, para 12 barcos. O painel já lista os 13 duelos e preenche os barcos de cada um conforme os resultados saem.

Na buzina, toque em **Largada** no duelo; quando cada barco cruzar a chegada, toque em **Chegou** e o tempo dele é gravado na hora. A largada fica guardada no aparelho, então a chegada tem de ser marcada no mesmo aparelho. Para corrigir ou digitar um tempo à mão, toque no duelo.

| Etapa | Duelos | `stage` | Quem entra | Quem sai |
| --- | --- | --- | --- | --- |
| 1 | A1 a A6 | `r16` | chaveamento da comissão (1º × 12º, 2º × 11º…) | os 6 perdedores ficam do 7º ao 12º, pelo tempo |
| 2 | B1 a B3 | `qf` | B1 = A1 × A6, B2 = A2 × A5, B3 = A3 × A4 | o perdedor de melhor tempo volta pela repescagem (B4); os outros dois ficam em 5º e 6º |
| 3 | C1 e C2 | `sf` | C1 = B1 × repescagem, C2 = B2 × B3 | os perdedores disputam o 3º lugar |
| 4 | disputa de 3º | `third` | perdedores de C1 e C2 | 3º e 4º |
| Final | final | `final` | vencedores de C1 e C2 | 1º e 2º |

- **`match_duels`**: uma linha por duelo: `stage`, `slot` (o número do duelo: A4 é `r16` com `slot` 4), os dois barcos e o tempo de cada um em segundos (`182.4`).
- Vence o menor tempo; barco sem tempo perde o duelo. Na Etapa 1, duelo sem `team_b` é um bye: o `team_a` passa direto.
- O barco gravado no duelo vale sobre o que a chave indica. Se um resultado anterior for corrigido depois, o painel avisa no duelo seguinte para conferir os barcos.
- A colocação sai da chave (view `race_scores`). Barco que não largou ou não terminou: marque em "Situação dos barcos".

## Exceções: `race_status`

Só é preciso criar uma linha quando:

- o barco **não largou**: `status = dns` (0 pontos);
- o barco **largou e não terminou**: `status = dnf` (20 pontos). Isso vale também para reboque ou para quem não fecha a última volta no prazo;
- for preciso **corrigir a colocação à mão**: preencha `position`.

`note` aparece ao lado do resultado no app (ex.: "reboque na volta 4").

## Penalidades

- **`penalties`**: `team_id`, `points` (negativo, ex.: `-10`), `reason` (aparece no app) e, se for de uma prova, `race_id`.

## Regra que o edital não cobre

A tabela de pontos vai só até o 15º lugar. Do 16º em diante o app dá 50 pontos. Para mudar, altere a função `placement_points` numa nova migration.
