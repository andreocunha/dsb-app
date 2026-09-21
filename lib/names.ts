/**
 * Mostra só o primeiro e o último nome.
 * Nomes completos quebram o balão do chat e a linha do ranking.
 */
export function shortName(name: string) {
  const partes = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return partes[0] ?? '';
  return `${partes[0]} ${partes[partes.length - 1]}`;
}
