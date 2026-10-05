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

- **`match_duels`**: uma linha por duelo: `stage` (`r32`, `r16`, `qf`, `sf`, `third`, `final`), `slot` (1, 2, 3…), os dois barcos e o tempo de cada um em segundos (`182.4`).
- Na fase seguinte, o duelo N recebe os vencedores dos duelos 2N−1 e 2N da fase anterior. Por exemplo, o duelo 1 das quartas junta os vencedores dos duelos 1 e 2 das oitavas.
- Vence o menor tempo. Duelo sem `team_b` é um bye: o `team_a` passa direto.
- A colocação sai da chave. Quem cai na mesma fase é ordenado pelo tempo que fez.

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
