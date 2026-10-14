/**
 * Mostra só o primeiro e o último nome.
 * Nomes completos quebram o balão do chat e a linha do ranking.
 */
export function shortName(name: string) {
  const todas = (name ?? '').trim().split(/\s+/).filter(Boolean);
  // Pedaços sem letra nem número (ex.: "⸻⸻⸻") não são nome: só enfeite que estoura a linha.
  const comLetra = todas.filter(parte => /[\p{L}\p{N}]/u.test(parte));
  const partes = comLetra.length ? comLetra : todas;
  if (partes.length < 2) return partes[0] ?? '';
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

/** Ordem fixa das equipes: alfabética, com o número do barco valendo como número ("2 - …" antes de "10 - …"). */
export const byTeamName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true });

/** Nome da equipe sem o número do barco na frente: "9 - Solaris" vira "Solaris". */
export const teamNameOnly = (name: string) => name.replace(/^\s*\d+\s*[-–—]\s*/, '') || name;
